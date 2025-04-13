import React, { useRef, useState, useMemo } from "react";
import { StatusBar } from "react-native";

import { SafeAreaProvider } from "react-native-safe-area-context";
import { useColorScheme } from "~/theme";
import { Provider as PaperProvider } from "react-native-paper";
import { NavigationContainer } from "@react-navigation/native";
import { ToastProvider } from "~/lib/toast-notifications";

import ComposeComponents from "~/lib/react/ComposeComponents";

import { RootNavCtx, DrawerStateCtx, LayoutKeyCtx } from "~/navigation/Context";
import { Light as PaperLightTheme, Dark as PaperDarkTheme } from "~/theme/app";
import {
  Light as NavigationLightTheme,
  Dark as NavigationDarkTheme,
} from "~/theme/navigation";

// import { navActions } from "~/stores";

// const linking = {
//   prefixes: ['https://app.alertesecours.fr', 'com.alertesecours://'],
//   config: {
//     screens: {
//       Home: 'home',
//       Details: 'details/:id',
//     },
//   },
// };

export default function LayoutProviders({ layoutKey, setLayoutKey, children }) {
  const scheme = useColorScheme();

  const navigationRef = useRef();

  const [drawerState, setDrawerState] = useState(() => ({
    homeFocused: false,
    topTabFocused: "",
  }));
  const drawerStateCtxVal = useMemo(
    () => [drawerState, setDrawerState],
    [drawerState, setDrawerState],
  );

  const LayoutKeyCtxVal = useMemo(
    () => [layoutKey, setLayoutKey],
    [layoutKey, setLayoutKey],
  );

  const dark = scheme === "dark";

  return (
    <>
      <StatusBar
        barStyle={dark ? "dark-content" : "light-content"}
        backgroundColor={dark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)"}
        translucent
      />
      <ComposeComponents
        components={[
          SafeAreaProvider,
          [PaperProvider, { theme: dark ? PaperDarkTheme : PaperLightTheme }],
          [RootNavCtx.Provider, { value: navigationRef }],
          [DrawerStateCtx.Provider, { value: drawerStateCtxVal }],
          [LayoutKeyCtx.Provider, { value: LayoutKeyCtxVal }],
          [
            ToastProvider,
            {
              duration: 5000,
              animationType: "zoom-in",
              animationDuration: 250,
              swipeEnabled: true,
              offsetTop: 160,
              offsetBottom: 50,
            },
          ],
        ]}
      >
        <NavigationContainer
          theme={dark ? NavigationDarkTheme : NavigationLightTheme}
          // linking={linking}
          ref={navigationRef}
          onReady={() => {}}
          onStateChange={(state) => {
            // const route = navigationRef.current.getCurrentRoute();
            // navActions.updateRouteFromNavigationContainer(state);
          }}
        >
          {children}
        </NavigationContainer>
      </ComposeComponents>
    </>
  );
}
