import { useData } from "vike-react/useData";
import { ApikeyManager } from "../../components/ApikeyManager";
import { KeepOriginalToggle } from "../../components/KeepOriginalToggle";
import { PasswordForm } from "../../components/PasswordForm";
import type { Data } from "./+data";

export default function Page() {
  const { settings, apikeys } = useData<Data>();
  return (
    <main className="flex flex-col gap-10 p-6">
      <section>
        <h2 className="mb-3 text-lg font-bold">Upload</h2>
        <KeepOriginalToggle initialKeepOriginal={settings.keep_original} />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">API keys</h2>
        <ApikeyManager initialKeys={apikeys} />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">Password</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
