import React, { useEffect, useState } from "react";
import ComposeComponents from "~/lib/react/ComposeComponents";

import { ApolloProvider } from "@apollo/client";

import createApolloClient from "~/network/apollo";

import createAxios from "~/network/axios";
import createKy from "~/network/ky";

import network from "~/network";

import env from "~/env";

import Loader from "~/components/Loader";

import * as store from "~/stores";

import getRetryMaxAttempts from "./getRetryMaxAttemps";

const { useNetworkState, networkActions } = store;

const initializeNewApolloClient = (reload) => {
  if (reload) {
    const { apolloClient } = network;
    apolloClient.stop();
    apolloClient.clearStore();
  }

  network.apolloClient = createApolloClient({
    store,
    GRAPHQL_URL: env.GRAPHQL_URL,
    GRAPHQL_WS_URL: env.GRAPHQL_WS_URL,
    getRetryMaxAttempts,
  });
};
initializeNewApolloClient();

// const oaFilesAxios = createAxios({ baseURL: env.OA_FILES_URL });
// network.oaFilesAxios = oaFilesAxios;
const oaFilesKy = createKy({ prefixUrl: env.OA_FILES_URL + "/" }, { store });
network.oaFilesKy = oaFilesKy;

network.axios = createAxios();

export default function NetworkProviders({ children }) {
  const [key, setKey] = useState(0);

  const networkState = useNetworkState(["initialized", "triggerReload"]);
  useEffect(() => {
    if (networkState.triggerReload) {
      initializeNewApolloClient(true);
      setKey((prevKey) => prevKey + 1);
    }
  }, [networkState.triggerReload]);

  useEffect(() => {
    if (key > 0) {
      networkActions.onReload();
    }
  }, [key]);

  if (!networkState.initialized) {
    return <Loader />;
  }

  const providers = [[ApolloProvider, { client: network.apolloClient }]];

  return (
    <ComposeComponents key={key} components={providers}>
      {children}
    </ComposeComponents>
  );
}
