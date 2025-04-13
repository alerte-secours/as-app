const path = require("path");

module.exports = {
  root: true,
  env: {
    "react-native/react-native": true,
  },
  extends: [
    "plugin:prettier/recommended",
    "plugin:import/recommended",
    "plugin:jsx-a11y/recommended",
    "plugin:react-hooks/recommended",
  ],
  parser: "@babel/eslint-parser",
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    ecmaVersion: 2021,
    sourceType: "module",
    babelOptions: {
      configFile: path.resolve(__dirname, "babel.config.js"),
    },
  },
  plugins: [
    "babel",
    "sort-keys-fix",
    "react",
    "react-native",
    "unused-imports",
    "autoimport-declarative",
  ],
  settings: {
    react: {
      version: "detect",
    },
    "import/ignore": ["react-native"],
    "import/resolver": {
      typescript: {},
    },
  },
  ignorePatterns: ["build", "node_modules", "e2e"],
  rules: {
    "no-undef": [2],
    "react/forbid-prop-types": [0],
    "react/jsx-uses-react": 1,
    "react/jsx-uses-vars": 1,
    "react-hooks/exhaustive-deps": "error",
    "jsx-a11y/no-autofocus": 0,
    "import/no-named-as-default": 0,
    "import/no-named-as-default-member": 0,
    // 'unused-imports/no-unused-imports-ts': 1, # enable and run yarn lint --fix to autoremove all unused imports
    "autoimport-declarative/autoimport": [
      1,
      {
        packages: {
          react: [
            "useState",
            "useEffect",
            "useContext",
            "useReducer",
            "useCallback",
            "useMemo",
            "useRef",
            "useImperativeHandle",
            "useLayoutEffect",
            "useDebugValue",
            "createRef",
            "forwardRef",
            {
              name: "React",
              isDefault: true,
            },
          ],
          "react-native": [
            "useWindowDimensions",
            "View",
            "TouchableOpacity",
            "TouchableHighlight",
            "Image",
            "StyleSheet",
          ],
          "@react-navigation/native": [
            "useNavigation",
            "useFocusEffect",
            "useIsFocused",
          ],
          "@maplibre/maplibre-react-native": [
            {
              name: "Maplibre",
              isDefault: true,
            },
          ],
          "@expo/vector-icons": [
            "MaterialCommunityIcons",
            "MaterialIcons",
            "Entypo",
            "FeatherMaterialIcons",
          ],
          "react-native-paper": ["ToggleButton", "Button", "FAB"],
          "@apollo/client": ["useQuery", "useMutation", "useLazyQuery"],
          "react-hook-form": [
            "FormProvider",
            "Controller",
            "useForm",
            "useFormContext",
            "useFieldArray",
            "useField",
          ],
          moment: [
            {
              name: "moment",
              isDefault: true,
            },
          ],
          "hooks/useStreamQueryWithSubscription": [
            {
              name: "useStreamQueryWithSubscription",
              isDefault: true,
            },
          ],
          "~/theme": ["useTheme", "createStyles"],
          "~/lib/toast-notifications": ["useToast"],
          "~/lib/geo/humanizeDistance": [
            {
              name: "humanizeDistance",
              isDefault: true,
            },
          ],
          "~/components/Text": [
            {
              name: "Text",
              isDefault: true,
            },
          ],
        },
      },
    ],
  },
  globals: {
    AbortController: true,
  },
};
