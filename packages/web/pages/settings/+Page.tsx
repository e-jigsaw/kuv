import { ApikeyManager } from "../../components/ApikeyManager";
import { KeepOriginalToggle } from "../../components/KeepOriginalToggle";
import { PasswordForm } from "../../components/PasswordForm";

export default function Page() {
  return (
    <main className="flex flex-col gap-10 p-6">
      <section>
        <h2 className="mb-3 text-lg font-bold">Upload</h2>
        <KeepOriginalToggle />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">API keys</h2>
        <ApikeyManager />
      </section>
      <section>
        <h2 className="mb-3 text-lg font-bold">Password</h2>
        <PasswordForm />
      </section>
    </main>
  );
}
