import {
  AccessibilityInfo,
  findNodeHandle,
  InteractionManager,
} from "react-native";

export function setA11yFocus(refOrNode) {
  const node = findNodeHandle(refOrNode?.current ?? refOrNode);
  if (!node) return;

  AccessibilityInfo.setAccessibilityFocus(node);
}

export function setA11yFocusAfterInteractions(refOrNode) {
  InteractionManager.runAfterInteractions(() => setA11yFocus(refOrNode));
}
