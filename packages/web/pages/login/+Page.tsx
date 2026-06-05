import { navigate } from "vike/client/router";
import { LoginForm } from "../../components/LoginForm";

export default function Page() {
  return <LoginForm onLoggedIn={() => navigate("/")} />;
}
