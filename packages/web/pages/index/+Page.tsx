import { useData } from "vike-react/useData";
import { HomePage } from "../../components/HomePage";
import type { Data } from "./+data";

export default function Page() {
  const { images } = useData<Data>();
  return <HomePage initialImages={images} />;
}
