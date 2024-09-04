import express from "express";
import bodyParser from "body-parser";
import morgan from "morgan";
import jwt from "jsonwebtoken";
import "dotenv/config";
import { randomUUID } from "crypto";

import graphSdk from "@microsoft/microsoft-graph-client";
import azureAuthProvider from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import azureIdentity from "@azure/identity";

//Create an express instance
const app = express();

const port = 3050;
const wicketApiUrl = process.env.WICKET_API_URL;
const wicketAdminUuid = process.env.WICKET_ADMIN_UUID;
const wicketApiSecret = process.env.WICKET_API_SECRET;

const azureExtensionsAppId = String(process.env.B2C_EXTENSIONS_CLIENT_ID).replaceAll('-', '');
const extension_WicketUUIDKey = `extension_${azureExtensionsAppId}_WicketUUID`

// @azure/identity
const credential = new azureIdentity.ClientSecretCredential(
  process.env.B2C_TENANT_ID,
  process.env.B2C_CLIENT_ID,
  process.env.B2C_CLIENT_SECRET
);

// @microsoft/microsoft-graph-client/authProviders/azureTokenCredentials
const authProvider =
  new azureAuthProvider.TokenCredentialAuthenticationProvider(credential, {
    // The client credentials flow requires that you request the
    // /.default scope, and pre-configure your permissions on the
    // app registration in Azure. An administrator must grant consent
    // to those permissions beforehand.
    scopes: ["https://graph.microsoft.com/.default"],
  });

const graphClient = graphSdk.Client.initWithMiddleware({
  authProvider: authProvider,
});

async function getWicketAdminJwt() {
  const payload = {
    sub: wicketAdminUuid,
  };

  return jwt.sign(payload, wicketApiSecret, { expiresIn: "60s" });
}

app.use(morgan("combined"));

// Support JSON-encoded bodies
app.use(bodyParser.json());

// to support URL-encoded bodies
app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.post("/wicket/role-webhook", async (req, res) => {
  // Handle test webhook
  if (req.body.events && req.body.test) return res.status(200).send({});

  // Filter events applying to only the user role
  const userRoleEvents = req.body.events.filter(
    (e) => e.entity_type == "Person" && e.role_name === "user"
  );

  const changedPeople = new Set(userRoleEvents.map((e) => e.entity_uuid));

  // No user roles changed in this webhook, can exit early.
  if (changedPeople.size === 0) return res.status(200).send({});

  // Find people who have had the roles changed
  const url = new URL("/people/query", wicketApiUrl);

  // Only fetch necessary fields
  url.searchParams.set(
    "fields[people]",
    ["given_name", "family_name", "full_name", "user", "user_identities", "role_names"].join(
      ","
    )
  );

  url.searchParams.set("include", "user_identities");
  url.searchParams.set("page[size]", changedPeople.size);

  const query = {
    filter: {
      uuid_in: Array.from(changedPeople),
    },
  };

  const token = await getWicketAdminJwt();
  const headers = {
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${token}`,
  };

  const personLookupResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(query),
  });

  const personLookupBody = await personLookupResponse.json();

  for (const person of personLookupBody.data) {
    if (person.attributes.role_names.includes("user")) {
      // User has not been provisioned in B2C yet, trigger a sync
      if (person.relationships.user_identities.data.length === 0) {
        const graphUser = {
          givenName: person.attributes.given_name,
          surname: person.attributes.full_name,
          displayName: person.attributes.full_name,
          accountEnabled: true,
          passwordProfile: {
            forceChangePasswordNextSignIn: true,
            password: randomUUID(),
          },
          passwordPolicies: "DisablePasswordExpiration",
          [extension_WicketUUIDKey]: person.id,
          identities: [
            {
              signInType: "emailAddress",
              issuer: process.env.B2C_TENANT_DOMAIN_NAME,
              issuerAssignedId: person.attributes.user.email,
            },
          ],
        };

        try {
          const graphUserResponse = await graphClient.api('/users').post(graphUser);

          const url = new URL("/user_identities/provision", wicketApiUrl);
          const provisionResponse = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              data: {
                type: "user_identities",
                attributes: {
                  provider_slug: "b2c",
                  external_id: graphUserResponse.id,
                  email: person.attributes.user.email
                },
              },
            }),
          });

        } catch (e) {
          console.error(e);
        }
      }
    } else {
      // TODO: Handle user role revoked
    }
  }

  res.status(200).send({});
});

app.post("/wicket/verify-signup", async (req, res) => {
  const url = new URL("/people", wicketApiUrl);
  url.searchParams.set("filter[emails_address_eq]", req.body.email);
  url.searchParams.set("filter[emails_unique_eq]", "true");
  url.searchParams.set("fields[people]", "user,user_identities");
  url.searchParams.set("include", "user_identities");
  url.searchParams.set("page[size]", 1);

  const token = await getWicketAdminJwt();
  const headers = {
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${token}`,
  };

  const personLookupResponse = await fetch(url, { headers });
  const personLookupBody = await personLookupResponse.json();

  let developerMessage = "There was an error registering, please try again.";

  if (personLookupResponse.ok) {
    // No people found with this email, sign up can continue
    if (personLookupBody.data.length === 0) {
      res.status(200).send({});
      return;
    }

    const person = personLookupBody.data[0];
    const userIdentities = person.relationships.user_identities.data.map(
      (rel) =>
        personLookupBody.included.find(
          (item) => item.type === rel.type && item.id === rel.id
        )
    );

    const existingIdentity = userIdentities.find(
      (identity) => identity.attributes.provider_slug === "b2c"
    );

    // No identities attached to this user for this provider, sign up can continue
    if (!existingIdentity) {
      res.status(200).send({});
      return;
    }

    // Allow attaching to user when email is not a primary
    if (person.attributes.user.email !== req.body.email.toLowerCase()) {
      res.status(200).send({});
      return;
    }

    developerMessage += ` User had an existing B2C identity attached object_id=${existingIdentity.attributes.external_id}`;
  } else {
    developerMessage += ` Wicket API responded with status ${personLookupResponse.status}`;
  }

  res.status(409).send({
    version: "1.0",
    status: 409,
    userMessage: "There was an error registering, please try again.",
    developerMessage,
  });
});

app.post("/wicket/provision", async (req, res) => {
  
  const token = await getWicketAdminJwt();
  const headers = {
    "Content-Type": "application/vnd.api+json",
    Authorization: `Bearer ${token}`,
  };

  const url = new URL("/user_identities/provision", wicketApiUrl);
  const provisionResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        type: "user_identities",
        attributes: {
          provider_slug: "b2c",
          external_id: req.body.objectId,
          email: req.body.email,
          person: {
            given_name: req.body.givenName,
            family_name: req.body.surName,
          },
        },
      },
    }),
  });

  if (provisionResponse.ok) {
    const provisionResponseBody = await provisionResponse.json();
    const b2cClaims = {
      personUuid: provisionResponseBody.data.relationships.person.data.id,
      userIdentityId: provisionResponseBody.data.id,
    };

    console.log(`provisioned user ${req.body.objectId}`, b2cClaims);

    res.status(200).send(b2cClaims);
  } else {
    res.status(409).send({
      version: "1.0",
      status: 409,
      userMessage: "There was an error logging in, please try again.",
      developerMessage: `There was an error calling ${url.pathname} - response code ${provisionResponse.status}`,
    });
  }
});

const server = app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});

const shutdown = () => {
  console.log("stopping ...");
  server.close(() => {
    console.log("stopped");
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
