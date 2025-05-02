import * as Device from "expo-device";

import network from "~/network";

import {
  REGISTER_USER_MUTATION,
  LOGIN_USER_TOKEN_MUTATION,
  STORE_FCM_TOKEN_MUTATION,
} from "~/auth/gql";

import { getDeviceUuid } from "./deviceUuid";

export async function registerUser() {
  const { data } = await network.apolloClient.mutate({
    mutation: REGISTER_USER_MUTATION,
    context: {
      skipAuth: true, // Skip adding Authorization header
    },
  });
  const authToken = data.addOneAuthInitToken.authTokenJwt;
  return { authToken };
}

export async function loginUserToken({ authToken }) {
  const deviceUuid = await getDeviceUuid();
  const { data } = await network.apolloClient.mutate({
    mutation: LOGIN_USER_TOKEN_MUTATION,
    variables: {
      authTokenJwt: authToken,
      phoneModel: Device.modelName,
      deviceUuid,
    },
    context: {
      skipAuth: true, // Skip adding Authorization header
    },
  });
  const userToken = data.doAuthLoginToken.userBearerJwt;
  return { userToken };
}

export async function storeFcmToken({ deviceId, fcmToken }) {
  const { data } = await network.apolloClient.mutate({
    mutation: STORE_FCM_TOKEN_MUTATION,
    variables: {
      deviceId,
      fcmToken,
    },
  });
  const { updatedAt } = data.updateOneDevice;
  return { updatedAt };
}
