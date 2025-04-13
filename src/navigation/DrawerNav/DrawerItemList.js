import SectionSeparator from "./SectionSeparator";
import menuItem from "./menuItem";

export default function DrawerItemList(props) {
  const { state } = props;
  const { index } = state;

  const routeMenuItem = (route, i) => {
    const mainFocused = i === index;
    return menuItem({
      mainFocused,
      route,
      state,
      ...props,
    });
  };

  const { routes } = state;

  const section1 = routes.slice(0, 5);
  const section2 = routes.slice(5, 8);
  const section3 = routes.slice(8, routes.length);

  return (
    <>
      <SectionSeparator label="Mon compte" />
      {section2.map((props, i) => routeMenuItem(props, i + 5))}
      <SectionSeparator label="Alerter" />
      {section1.map((props, i) => routeMenuItem(props, i + 0))}
      <SectionSeparator label="Infos pratiques" />
      {section3.map((props, i) => routeMenuItem(props, i + 8))}
    </>
  );
}
