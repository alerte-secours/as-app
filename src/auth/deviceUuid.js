import { secureStore } from "~/lib/secureStore";
import uuidGenerator from "react-native-uuid";

async function getDeviceUuid() {
  let deviceUuid = await secureStore.getItemAsync("deviceUuid");
  if (!deviceUuid) {
    deviceUuid = uuidGenerator.v4();
    await secureStore.setItemAsync("deviceUuid", deviceUuid);
  }
  return deviceUuid;
}

export { getDeviceUuid };
