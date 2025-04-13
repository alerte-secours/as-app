import { TextInput } from "react-native-paper";
import { useFormContext } from "react-hook-form";
export default function FieldInputText({
  name,
  shouldDirty = true,
  error,
  ...inputProps
}) {
  const { setValue, trigger, watch } = useFormContext();
  const value = watch(name);

  const handleChangeText = async (newValue) => {
    await setValue(name, newValue, { shouldDirty });

    // If there's currently an error, validate immediately
    // see also https://github.com/orgs/react-hook-form/discussions/10114
    if (error) {
      await trigger(name);
    }
  };

  const handleBlur = async () => {
    await trigger(name);
  };

  return (
    <TextInput
      name={name}
      onChangeText={handleChangeText}
      onBlur={handleBlur}
      value={value}
      error={error}
      {...inputProps}
    />
  );
}
