import { View, ScrollView } from "react-native";
import { Button, ToggleButton } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";

import humanizeDistance from "~/lib/geo/humanizeDistance";
import { useTheme } from "~/theme";

import { profileDefaultModes } from "./routing";

import humanizeDuration from "~/utils/time/humanizeDuration";

import RoutingStep from "./RoutingStep";
import Text from "~/components/Text";

import { STATE_CALCULATING_LOADED } from "./constants";

import RoutingCalculating from "./RoutingCalculating";

export default function RoutingSteps({
  setProfile,
  profile,
  destinationName,
  closeStepper,
  instructions,
  distance,
  duration,
  calculatingState,
}) {
  const { colors, custom } = useTheme();
  const profileDefaultMode = profileDefaultModes[profile];

  if (distance === 0) {
    instructions = instructions.slice(1);
  }

  // calculatingState = 2;

  return (
    <>
      <ScrollView
        style={{
          flex: 1,
          backgroundColor: colors.surface,
          paddingTop: 0,
          paddingLeft: 10,
          paddingRight: 10,
          marginTop: 4,
          marginBottom: 4,
          borderTopRightRadius: 8,
          borderBottomRightRadius: 8,
        }}
      >
        <View
          style={{
            flex: 1,
            paddingTop: 10,
            flexDirection: "row",
          }}
        >
          <ToggleButton.Group onValueChange={setProfile} value={profile}>
            <ToggleButton
              value="car"
              icon={() => {
                return (
                  <MaterialCommunityIcons
                    name="car"
                    size={22}
                    style={{ paddingRight: 5 }}
                  />
                );
              }}
            />
            <ToggleButton
              value="foot"
              icon={() => {
                return (
                  <MaterialCommunityIcons
                    name="walk"
                    size={22}
                    style={{ paddingRight: 5 }}
                  />
                );
              }}
            />
            <ToggleButton
              value="bicycle"
              icon={() => {
                return (
                  <MaterialCommunityIcons
                    name="bike"
                    size={22}
                    style={{ paddingRight: 5 }}
                  />
                );
              }}
            />
          </ToggleButton.Group>
        </View>
        {calculatingState === STATE_CALCULATING_LOADED && (
          <>
            <View
              style={{
                flex: 1,
                paddingTop: 10,
                flexDirection: "row",
              }}
            >
              <Text
                key={"destinationName"}
                style={{
                  fontSize: 17,
                  fontWeight: "bold",
                  color: colors.primary,
                  paddingRight: 5,
                }}
              >
                {destinationName}
              </Text>
              <Text
                key="distance"
                style={{ fontSize: 17, color: colors.primary }}
              >
                {humanizeDistance(distance)}
              </Text>
              <Text
                key="duration"
                style={{ fontSize: 17, color: colors.primary }}
              >
                {", " + humanizeDuration(duration)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              {instructions.map((instruction, index) => {
                return (
                  <View
                    key={index}
                    style={{
                      borderBottomWidth: 0.5,
                      borderBottomColor: colors.active,
                      borderColor: colors.grey,
                    }}
                  >
                    <RoutingStep
                      instructions={instructions}
                      instruction={instruction}
                      profileDefaultMode={profileDefaultMode}
                    />
                  </View>
                );
              })}
            </View>
          </>
        )}
        {calculatingState !== STATE_CALCULATING_LOADED && (
          <RoutingCalculating
            key="head-routing-calculating"
            calculatingState={calculatingState}
          />
        )}
      </ScrollView>
      <View
        style={{
          position: "absolute",
          overflow: "hidden",
          top: 4,
          right: 0,
          flex: 1,
          width: 26,
          height: 26,
          backgroundColor: colors.surface,
          borderRadius: 8,
        }}
      >
        <Button
          style={{
            flex: 1,
            borderRadius: 0,
            alignSelf: "center",
            left: 5,
          }}
          onPress={closeStepper}
          icon={() => (
            <MaterialCommunityIcons
              name="close"
              size={26}
              style={{ flex: 1 }}
            />
          )}
        />
      </View>
    </>
  );
}
