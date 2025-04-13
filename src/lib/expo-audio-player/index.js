import React, { PureComponent } from "react";
import {
  TouchableOpacity,
  Animated,
  PanResponder,
  View,
  Easing,
} from "react-native";
import { Audio } from "expo-av";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import sleep from "./sleep";
import DigitalTimeString from "./DigitalTimeString";

import useStyles from "./styles";
import withHooks from "~/hoc/withHooks";

const TRACK_SIZE = 4;
const THUMB_SIZE = 20;

class AudioSlider extends PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      playing: false,
      currentTime: 0, // miliseconds; value interpolated by animation.
      duration: 0,
      trackLayout: {},
      dotOffset: new Animated.ValueXY(),
      xDotOffsetAtAnimationStart: 0,
    };

    this._updateProps();

    // Important:
    // this.state.dotOffset.x is the actual offset
    // this.state.dotOffset.x._value is the offset from the point where the animation started
    // However, since this.state.dotOffset.x is an object and not a value, it is difficult
    // to compare it with other numbers. Therefore, the const currentOffsetX is used.
    // To print all attributes of the object see https://stackoverflow.com/questions/9209747/printing-all-the-hidden-properties-of-an-object
    this._panResponder = PanResponder.create({
      onMoveShouldSetResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: async (e, gestureState) => {
        if (this.state.playing) {
          await this.pause();
        }
        await this.setState({
          xDotOffsetAtAnimationStart: this.state.dotOffset.x._value,
        });
        await this.state.dotOffset.setOffset({
          x: this.state.dotOffset.x._value,
        });
        await this.state.dotOffset.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (e, gestureState) => {
        Animated.event([
          null,
          { dx: this.state.dotOffset.x, dy: this.state.dotOffset.y },
        ])(e, gestureState);
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: async (evt, gestureState) => {
        // Another component has become the responder, so this gesture is cancelled.

        const currentOffsetX =
          this.state.xDotOffsetAtAnimationStart + this.state.dotOffset.x._value;
        if (
          currentOffsetX < 0 ||
          currentOffsetX > this.state.trackLayout.width
        ) {
          await this.state.dotOffset.setValue({
            x: -this.state.xDotOffsetAtAnimationStart,
            y: 0,
          });
        }
        await this.state.dotOffset.flattenOffset();
        await this.mapAudioToCurrentTime();
      },
      onPanResponderRelease: async (e, { vx }) => {
        const currentOffsetX =
          this.state.xDotOffsetAtAnimationStart + this.state.dotOffset.x._value;
        if (
          currentOffsetX < 0 ||
          currentOffsetX > this.state.trackLayout.width
        ) {
          await this.state.dotOffset.setValue({
            x: -this.state.xDotOffsetAtAnimationStart,
            y: 0,
          });
        }
        await this.state.dotOffset.flattenOffset();
        await this.mapAudioToCurrentTime();
      },
    });
  }

  _updateProps() {
    const props = this.props;
    this.registry = props.registry;
    this.style = props.style || {};
    if (this.registry) {
      this.registry.register(this);
    }
    const { pauseAllBeforePlay = true } = props;
    this.pauseAllBeforePlay = pauseAllBeforePlay;
  }

  componentDidUpdate() {
    this._updateProps();
  }

  mapAudioToCurrentTime = async () => {
    await this.soundObject.setPositionAsync(this.state.currentTime);
  };

  onPressPlayPause = async () => {
    if (this.state.playing) {
      await this.pause();
      return;
    }
    await this.play();
  };

  play = async () => {
    if (this.registry && this.pauseAllBeforePlay) {
      const players = this.registry.getAll();
      await Promise.all(
        players.filter((p) => this !== p).map((p) => p.pause()),
      );
    }
    await this.soundObject.playAsync();
    this.setState({ playing: true }); // This is for the play-button to go to play
    this.startMovingDot();
  };

  pause = async () => {
    await this.soundObject.pauseAsync();
    this.setState({ playing: false }); // This is for the play-button to go to pause
    Animated.timing(this.state.dotOffset, { useNativeDriver: false }).stop(); // Will also call animationPausedOrStopped()
  };

  startMovingDot = async () => {
    const status = await this.soundObject.getStatusAsync();
    const durationLeft = status["durationMillis"] - status["positionMillis"];

    Animated.timing(this.state.dotOffset, {
      toValue: { x: this.state.trackLayout.width, y: 0 },
      duration: durationLeft,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(() => this.animationPausedOrStopped());
  };

  animationPausedOrStopped = async () => {
    if (!this.state.playing) {
      // Audio has been paused
      return;
    }
    // Animation-duration is over (reset Animation and Audio):
    await sleep(200); // In case animation has finished, but audio has not
    this.setState({ playing: false });
    await this.state.dotOffset.setValue({ x: 0, y: 0 });
    // this.state.dotOffset.setValue(0);
    await this.soundObject.setPositionAsync(0);
  };

  measureTrack = (event) => {
    this.setState({ trackLayout: event.nativeEvent.layout }); // {x, y, width, height}
  };

  async componentDidMount() {
    // https://github.com/olapiv/expo-audio-player/issues/13

    const loadAudio = async () => {
      try {
        const { sound: newSound } = await Audio.Sound.createAsync({
          uri: this.props.audio,
        });
        this.soundObject = newSound;

        // // https://github.com/expo/expo/issues/1873
        this.soundObject.setOnPlaybackStatusUpdate((status) => {
          if (!status.didJustFinish) return;
          this.soundObject.unloadAsync().catch(() => {});
        });
      } catch (error) {
        console.log("Error loading audio:", error);
      }
    };

    await loadAudio();

    const status = await this.soundObject.getStatusAsync();
    this.setState({ duration: status.durationMillis });

    // This requires measureTrack to have been called.
    this.state.dotOffset.addListener(() => {
      const animatedCurrentTime = this.state.dotOffset.x
        .interpolate({
          inputRange: [0, this.state.trackLayout.width],
          outputRange: [0, this.state.duration],
          extrapolate: "clamp",
        })
        .__getValue();
      this.setState({ currentTime: animatedCurrentTime });
    });
  }

  async componentWillUnmount() {
    await this.soundObject.unloadAsync();
    this.state.dotOffset.removeAllListeners();
    if (this.registry) {
      this.registry.unregister(this);
    }
  }

  render() {
    return (
      <View
        style={{
          flex: 0,
          flexDirection: "column",
          justifyContent: "flex-start",
          alignItems: "stretch",
          paddingLeft: 8,
          paddingRight: 8,
        }}
      >
        <View
          style={{
            flex: 0,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingLeft: 8,
            paddingRight: 8,
            height: 35,
          }}
        >
          <TouchableOpacity
            style={{
              flex: 1,
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
              paddingRight: THUMB_SIZE,
              zIndex: 2,
            }}
            onPress={this.onPressPlayPause}
          >
            {this.state.playing ? (
              <MaterialCommunityIcons
                name="pause-circle-outline"
                size={30}
                style={[this.props.styles.controlIcon, this.style.controlIcon]}
              />
            ) : (
              <MaterialCommunityIcons
                name="play-circle-outline"
                size={30}
                style={[this.props.styles.controlIcon, this.style.controlIcon]}
              />
            )}
          </TouchableOpacity>

          <Animated.View
            onLayout={this.measureTrack}
            style={[
              this.props.styles.slideBar,
              this.style.slideBar,
              {
                height: TRACK_SIZE,
                borderRadius: TRACK_SIZE / 2,
              },
            ]}
          >
            <Animated.View
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                alignItems: "center",
                position: "absolute",
                left: -((THUMB_SIZE * 4) / 2),
                width: THUMB_SIZE * 4,
                height: THUMB_SIZE * 4,
                transform: [
                  {
                    translateX: this.state.dotOffset.x.interpolate({
                      inputRange: [
                        0,
                        this.state.trackLayout.width != undefined
                          ? this.state.trackLayout.width
                          : 1,
                      ],
                      outputRange: [
                        0,
                        this.state.trackLayout.width != undefined
                          ? this.state.trackLayout.width
                          : 1,
                      ],
                      extrapolate: "clamp",
                    }),
                  },
                ],
              }}
              {...this._panResponder.panHandlers}
            >
              <View
                style={[
                  this.props.styles.slideCursor,
                  this.style.slideCursor,
                  {
                    width: THUMB_SIZE,
                    height: THUMB_SIZE,
                    borderRadius: THUMB_SIZE / 2,
                  },
                ]}
              ></View>
            </Animated.View>
          </Animated.View>
        </View>

        <View
          style={{
            flex: 0,
            flexDirection: "row",
            justifyContent: "space-between",
          }}
        >
          <DigitalTimeString time={this.state.currentTime} style={this.style} />
          <DigitalTimeString time={this.state.duration} style={this.style} />
        </View>
      </View>
    );
  }
}

export default withHooks(AudioSlider, () => {
  const styles = useStyles();
  return { styles };
});
