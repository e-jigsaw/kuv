import { navigate } from "vike/client/router";
import { useData } from "vike-react/useData";
import { ImageView } from "../../../components/ImageView";
import type { Data } from "./+data";

export default function Page() {
  const { image } = useData<Data>();
  return <ImageView image={image} onDeleted={() => navigate("/")} />;
}
