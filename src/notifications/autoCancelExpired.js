import notifee from "@notifee/react-native";
import BackgroundFetch from "react-native-background-fetch";

import useMount from "~/hooks/useMount";

// Background task to cancel expired notifications
const backgroundTask = async () => {
  const notifications = await notifee.getDisplayedNotifications();
  const currentTime = Math.round(new Date() / 1000);
  for (const notification of notifications) {
    const expires = notification.data?.expires;
    if (expires && expires < currentTime) {
      await notifee.cancelNotification(notification.id);
    }
  }
};

export const useAutoCancelExpired = () => {
  useMount(() => {
    // Initialize background fetch
    BackgroundFetch.configure(
      {
        minimumFetchInterval: 180, // Fetch interval in minutes
        stopOnTerminate: false,
        startOnBoot: true,
        requiredNetworkType: BackgroundFetch.NETWORK_TYPE_NONE,
        enableHeadless: true,
      },
      async (taskId) => {
        console.log("[BackgroundFetch] taskId:", taskId);
        await backgroundTask();
        BackgroundFetch.finish(taskId);
      },
      (error) => {
        console.log("[BackgroundFetch] failed to start", error);
      },
    );
    return () => {
      BackgroundFetch.stop();
    };
  });
};

// Register headless task
BackgroundFetch.registerHeadlessTask(async (event) => {
  const taskId = event.taskId;
  await backgroundTask();
  BackgroundFetch.finish(taskId);
});
