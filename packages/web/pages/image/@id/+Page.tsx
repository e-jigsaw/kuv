import { navigate } from "vike/client/router";
import { usePageContext } from "vike-react/usePageContext";
import { ImageView } from "../../../components/ImageView";

export default function Page() {
  const pageContext = usePageContext();
  const id = pageContext.routeParams!.id!;
  return <ImageView id={id} onDeleted={() => navigate("/")} />;
}
