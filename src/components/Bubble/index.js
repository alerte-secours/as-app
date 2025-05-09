import React from "react";
import { View, StyleSheet, TouchableOpacity } from "react-native";

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "white",
    borderRadius: 30,
    bottom: 16,
    justifyContent: "center",
    left: 48,
    minHeight: 60,
    paddingVertical: 16,
    position: "absolute",
    right: 48,
  },
});

class Bubble extends React.PureComponent {
  render() {
    let innerChildView = this.props.children;

    if (this.props.onPress) {
      innerChildView = (
        <TouchableOpacity onPress={this.props.onPress}>
          {this.props.children}
        </TouchableOpacity>
      );
    }

    return (
      <View style={[styles.container, this.props.style]}>{innerChildView}</View>
    );
  }
}

export default Bubble;
