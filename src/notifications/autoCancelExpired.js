import notifee from "@notifee/react-native";
import BackgroundFetch from "react-native-background-fetch";
import * as Sentry from "@sentry/react-native";

import useMount from "~/hooks/useMount";
import { createLogger } from "~/lib/logger";

const logger = createLogger({
  service: "notifications",
  task: "auto-cancel-expired",
});

// Background task to cancel expired notifications
const backgroundTask = async () => {
  await Sentry.startSpan(
    {
      name: "auto-cancel-expired-notifications",
      op: "background-task",
    },
    async (span) => {
      try {
        logger.info("Starting auto-cancel expired notifications task");

        Sentry.addBreadcrumb({
          message: "Auto-cancel task started",
          category: "notifications",
          level: "info",
        });

        // Get displayed notifications with timeout protection
        let notifications;
        await Sentry.startSpan(
          {
            op: "get-displayed-notifications",
            description: "Getting displayed notifications",
          },
          async (getNotificationsSpan) => {
            try {
              // Add timeout protection for the API call
              notifications = await Promise.race([
                notifee.getDisplayedNotifications(),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error("Timeout getting notifications")),
                    10000,
                  ),
                ),
              ]);
              getNotificationsSpan.setStatus("ok");
            } catch (error) {
              getNotificationsSpan.setStatus("internal_error");
              throw error;
            }
          },
        );

        if (!Array.isArray(notifications)) {
          logger.warn("No notifications array received", { notifications });
          Sentry.addBreadcrumb({
            message: "No notifications array received",
            category: "notifications",
            level: "warning",
          });
          return;
        }

        const currentTime = Math.round(new Date() / 1000);
        let cancelledCount = 0;
        let errorCount = 0;

        logger.info("Processing notifications", {
          totalNotifications: notifications.length,
          currentTime,
        });

        Sentry.addBreadcrumb({
          message: "Processing notifications",
          category: "notifications",
          level: "info",
          data: {
            totalNotifications: notifications.length,
            currentTime,
          },
        });

        // Process notifications with individual error handling
        for (const notification of notifications) {
          try {
            if (!notification || !notification.id) {
              logger.warn("Invalid notification object", { notification });
              continue;
            }

            const expires = notification.data?.expires;
            if (!expires) {
              continue; // Skip notifications without expiry
            }

            if (typeof expires !== "number" || expires < currentTime) {
              logger.debug("Cancelling expired notification", {
                notificationId: notification.id,
                expires,
                currentTime,
                expired: expires < currentTime,
              });

              // Cancel notification with timeout protection
              await Promise.race([
                notifee.cancelNotification(notification.id),
                new Promise((_, reject) =>
                  setTimeout(
                    () => reject(new Error("Timeout cancelling notification")),
                    5000,
                  ),
                ),
              ]);

              cancelledCount++;

              Sentry.addBreadcrumb({
                message: "Notification cancelled",
                category: "notifications",
                level: "info",
                data: {
                  notificationId: notification.id,
                  expires,
                },
              });
            }
          } catch (notificationError) {
            errorCount++;
            logger.error("Failed to process notification", {
              error: notificationError,
              notificationId: notification?.id,
            });

            Sentry.captureException(notificationError, {
              tags: {
                module: "auto-cancel-expired",
                operation: "cancel-notification",
              },
              contexts: {
                notification: {
                  id: notification?.id,
                  expires: notification?.data?.expires,
                },
              },
            });
          }
        }

        logger.info("Auto-cancel task completed", {
          totalNotifications: notifications.length,
          cancelledCount,
          errorCount,
        });

        Sentry.addBreadcrumb({
          message: "Auto-cancel task completed",
          category: "notifications",
          level: "info",
          data: {
            totalNotifications: notifications.length,
            cancelledCount,
            errorCount,
          },
        });

        span.setStatus("ok");
      } catch (error) {
        logger.error("Auto-cancel task failed", { error });

        Sentry.captureException(error, {
          tags: {
            module: "auto-cancel-expired",
            operation: "background-task",
          },
        });

        span.setStatus("internal_error");
        throw error; // Re-throw to be handled by caller
      }
    },
  );
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
        logger.info("BackgroundFetch task started", { taskId });

        try {
          await backgroundTask();
          logger.info("BackgroundFetch task completed successfully", {
            taskId,
          });
        } catch (error) {
          logger.error("BackgroundFetch task failed", { taskId, error });

          Sentry.captureException(error, {
            tags: {
              module: "auto-cancel-expired",
              operation: "background-fetch-task",
              taskId,
            },
          });
        } finally {
          // CRITICAL: Always call finish, even on error
          try {
            if (taskId) {
              BackgroundFetch.finish(taskId);
              logger.debug("BackgroundFetch task finished", { taskId });
            } else {
              logger.error("Cannot finish BackgroundFetch task - no taskId");
            }
          } catch (finishError) {
            // This is a critical error - the native side might be in a bad state
            logger.error("CRITICAL: BackgroundFetch.finish() failed", {
              taskId,
              error: finishError,
            });

            Sentry.captureException(finishError, {
              tags: {
                module: "auto-cancel-expired",
                operation: "background-fetch-finish",
                critical: true,
              },
              contexts: {
                task: { taskId },
              },
            });
          }
        }
      },
      (error) => {
        logger.error("BackgroundFetch failed to start", { error });

        Sentry.captureException(error, {
          tags: {
            module: "auto-cancel-expired",
            operation: "background-fetch-configure",
          },
        });
      },
    );
    return () => {
      BackgroundFetch.stop();
    };
  });
};

// Register headless task
BackgroundFetch.registerHeadlessTask(async (event) => {
  const taskId = event?.taskId;

  logger.info("Headless task started", { taskId, event });

  // Add timeout protection for the entire headless task
  const taskTimeout = setTimeout(() => {
    logger.error("Headless task timeout", { taskId });

    Sentry.captureException(new Error("Headless task timeout"), {
      tags: {
        module: "auto-cancel-expired",
        operation: "headless-task-timeout",
        taskId,
      },
    });

    // Force finish the task to prevent native side hanging
    try {
      if (taskId) {
        BackgroundFetch.finish(taskId);
        logger.debug("Headless task force-finished due to timeout", { taskId });
      }
    } catch (finishError) {
      logger.error("CRITICAL: Failed to force-finish timed out headless task", {
        taskId,
        error: finishError,
      });

      Sentry.captureException(finishError, {
        tags: {
          module: "auto-cancel-expired",
          operation: "headless-task-timeout-finish",
          critical: true,
        },
        contexts: {
          task: { taskId },
        },
      });
    }
  }, 30000); // 30 second timeout

  try {
    if (!taskId) {
      throw new Error("No taskId provided in headless task event");
    }

    await backgroundTask();
    logger.info("Headless task completed successfully", { taskId });
  } catch (error) {
    logger.error("Headless task failed", { taskId, error });

    Sentry.captureException(error, {
      tags: {
        module: "auto-cancel-expired",
        operation: "headless-task",
        taskId,
      },
      contexts: {
        event: {
          taskId,
          eventData: JSON.stringify(event),
        },
      },
    });
  } finally {
    // Clear the timeout
    clearTimeout(taskTimeout);

    // CRITICAL: Always call finish, even on error
    try {
      if (taskId) {
        BackgroundFetch.finish(taskId);
        logger.debug("Headless task finished", { taskId });
      } else {
        logger.error("Cannot finish headless task - no taskId", { event });
      }
    } catch (finishError) {
      // This is a critical error - the native side might be in a bad state
      logger.error(
        "CRITICAL: BackgroundFetch.finish() failed in headless task",
        {
          taskId,
          error: finishError,
          event,
        },
      );

      Sentry.captureException(finishError, {
        tags: {
          module: "auto-cancel-expired",
          operation: "headless-task-finish",
          critical: true,
        },
        contexts: {
          task: { taskId },
          event: { eventData: JSON.stringify(event) },
        },
      });
    }
  }
});
