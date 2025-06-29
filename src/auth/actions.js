import * as Device from "expo-device";

import network from "~/network";
import env from "~/env";

import {
  STORE_FCM_TOKEN_MUTATION,
  REGISTER_USER_MUTATION_STRING,
  LOGIN_USER_TOKEN_MUTATION_STRING,
} from "~/auth/gql";

import { getDeviceUuid } from "./deviceUuid";

// to support refresh auth in headless mode we'll use axios instead of apollo
// read more https://github.com/transistorsoft/react-native-background-fetch/issues/562

export async function registerUser() {
  const { data } = await network.axios.post(
    env.GRAPHQL_URL,
    {
      query: REGISTER_USER_MUTATION_STRING,
    },
    {
      headers: {
        // Skip adding Authorization header for this request
        Authorization: undefined,
      },
    },
  );

  if (data.errors && data.errors.length > 0) {
    const message = data.errors.map((err) => err.message).join("; ");
    throw new Error(`GraphQL Error: ${message}`);
  }

  const authToken = data.data.addOneAuthInitToken.authTokenJwt;
  return { authToken };
}

export async function loginUserToken({ authToken }) {
  const deviceUuid = await getDeviceUuid();
  const { data } = await network.axios.post(
    env.GRAPHQL_URL,
    {
      query: LOGIN_USER_TOKEN_MUTATION_STRING,
      variables: {
        authTokenJwt: authToken,
        phoneModel: Device.modelName,
        deviceUuid,
      },
    },
    {
      headers: {
        // Skip adding Authorization header for this request
        Authorization: undefined,
      },
    },
  );

  if (data.errors && data.errors.length > 0) {
    const message = data.errors.map((err) => err.message).join("; ");
    throw new Error(`GraphQL Error: ${message}`);
  }

  const userToken = data.data.doAuthLoginToken.userBearerJwt;
  return { userToken };
}

export async function storeFcmToken({ deviceId, fcmToken }) {
  const { data, errors } = await network.apolloClient.mutate({
    mutation: STORE_FCM_TOKEN_MUTATION,
    variables: {
      deviceId,
      fcmToken,
    },
  });
  if (errors && errors.length > 0) {
    // Concatenate all error messages
    const message = errors.map((err) => err.message).join("; ");
    throw new Error(`GraphQL Error: ${message}`);
  }
  const { updatedAt } = data.updateOneDevice;
  return { updatedAt };
}
