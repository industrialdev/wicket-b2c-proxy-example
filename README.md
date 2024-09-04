# Run the example proxy

Using NodeJS >=20

Copy `.env.example` to `.env`, populate the necessary details.

```
npm install
npm start
```

B2C Requires a publicly accessible URL, a tool such as https://ngrok.com/ can be used to proxy the request to the example application

```
ngrok http 3050
```

Provided sample endpoints:

- /wicket/role-webhook
  - Example of consuming the Wicket role granted / revoked webhooks and provisioning users in B2C via the Graph API.
- /wicket/verify-signup
  - Called during sign up (or email change) to verify the users email is available in Wicket and not assigned to another person with an active B2C account.
- /wicket/provision
  - Calls the Wicket `/user_identities/provision` endpoint and returns any claims for B2C to consume.


## B2C Policies

Included are some example policies based on the LocalAccounts starter pack provided by Azure:

- https://learn.microsoft.com/en-us/azure/active-directory-b2c/tutorial-create-user-flows?pivots=b2c-custom-policy
- https://github.com/Azure-Samples/active-directory-b2c-custom-policy-starterpack/tree/main/LocalAccounts

They have been extended to make use Wicket [UserIdentity provisioning](https://wicketapi.docs.apiary.io/#reference/main-resources/user-identities) API's and custom logic on sign up.

These policies are provided as a starting point and will have to be customized for a production ready setup.

The following B2C placeholders must be updated, see the [Azure prerequisites](https://learn.microsoft.com/en-us/azure/active-directory-b2c/tutorial-create-user-flows?pivots=b2c-custom-policy#prerequisites) for more details:

- tenant.onmicrosoft.com
- b2c-extensions-app_ApplicationObjectId
- b2c-extensions-app_ClientId
- ProxyIdentityExperienceFramework_ClientId
- IdentityExperienceFramework_ClientId

The following Wicket Specific placeholders must be updated:

- example-domain.ngrok.io (point to the public url for example proxy started above)