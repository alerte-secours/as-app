import { navActions } from "~/stores";

export default function actionOpenSettings({ data }) {
  navActions.setNextNavigation([
    {
      name: "Params",
    },
  ]);
}
