import "dotenv/config";

import graphSdk from "@microsoft/microsoft-graph-client";
import azureAuthProvider from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import azureIdentity from "@azure/identity";
import { parseArgs } from "node:util";


const azureExtensionsAppId = String(process.env.B2C_EXTENSIONS_CLIENT_ID).replaceAll('-', '');

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

const {
  values: { objectId, email },
} = parseArgs({
  options: {
    objectId: {
      type: "string",
      short: "o",
    },
    email: {
      type: "string",
      short: "e",
    },
  },
});

const graphUser = {
  identities: [
    {
      signInType: "emailAddress",
      issuer: process.env.B2C_TENANT_DOMAIN_NAME,
      issuerAssignedId: email,
    },
  ],
};

try {
  const graphUserResponse = await graphClient.api(`/users/${objectId}`).patch(graphUser);
  console.log(graphUserResponse);
} catch (e) {
  console.error(e.body);
  process.exit(1);
}