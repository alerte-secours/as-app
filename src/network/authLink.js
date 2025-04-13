import { ApolloLink } from "@apollo/client";

import { setBearerHeader } from "./headers";
import { createLogger } from "~/lib/logger";
import { NETWORK_SCOPES } from "~/lib/logger/scopes";

const authLinkLogger = createLogger({
  module: NETWORK_SCOPES.APOLLO,
  feature: "auth-link",
});

export default function createAuthLink({ store }) {
  const { getAuthState } = store;

  const authLink = new ApolloLink((operation, forward) => {
    const { userToken } = getAuthState();
    const headers = operation.getContext().hasOwnProperty("headers")
      ? operation.getContext().headers
      : {};
    if (userToken && headers["X-Hasura-Role"] !== "anonymous") {
      setBearerHeader(headers, userToken);
    } else {
      headers["X-Hasura-Role"] = "anonymous";
    }
    // authLinkLogger.debug("Request headers", { headers });
    operation.setContext({ headers });
    return forward(operation);
  });

  return authLink;
}
