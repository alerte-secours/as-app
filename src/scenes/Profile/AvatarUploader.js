import React, { useCallback, useState } from "react";
import { View, Image, TouchableWithoutFeedback } from "react-native";
import { IconButton, Avatar } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTheme } from "~/theme";
import { useFormContext } from "react-hook-form";
// import Text from "~/components/Text";
import ImageResizer from "@bam.tech/react-native-image-resizer";

import AvatarModalEdit from "./AvatarModalEdit";

import env from "~/env";
import bgColorBySeed from "~/lib/style/bg-color-by-seed";

export default function AvatarUploader({ data, userId }) {
  const { colors, custom } = useTheme();
  const { watch, setValue } = useFormContext();

  const username = watch("username");
  const image = watch("image");

  let imageSrc;
  if (image?.mode === "image") {
    if (image.localImage) {
      // const base64 = `data:${image.localImage.mime};base64,${image.localImage.data}`;
      // imageSrc = { uri: base64 };
      imageSrc = { uri: image.localImage.uri };
    } else if (image.imageFileUuid) {
      imageSrc = {
        uri: `${env.MINIO_URL}/avatar/${image.imageFileUuid}.png`,
      };
    }
  }
  const modalState = useState({ visible: false });
  const [, setModal] = modalState;
  const imageMode = image?.mode || "text";

  const edit = useCallback(() => {
    setModal({ visible: true });
  }, [setModal]);

  let color;
  if (imageMode === "text") {
    color = bgColorBySeed(username);
  }

  return (
    <View>
      <View style={{ flexDirection: "column", alignItems: "center" }}>
        <TouchableWithoutFeedback onPress={edit}>
          <View style={{ flexDirection: "column", alignItems: "center" }}>
            {imageMode === "image" && imageSrc && (
              <Image
                source={imageSrc}
                style={{
                  width: 120,
                  height: 120,
                  borderRadius: 120,
                  padding: 20,
                }}
              />
            )}
            {imageMode === "text" && (
              <Avatar.Text
                size={120}
                label={username ? username.slice(0, 1).toUpperCase() : "0"}
                backgroundColor={color}
              />
            )}
            <MaterialCommunityIcons
              name="pencil-circle"
              size={32}
              color={colors.primary}
              style={{
                right: -45,
                top: -35,
              }}
            />
          </View>
        </TouchableWithoutFeedback>
      </View>
      <AvatarModalEdit modalState={modalState} userId={userId} />
    </View>
  );
}
