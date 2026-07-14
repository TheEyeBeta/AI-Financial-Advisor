import { getSupportEmail } from "@/lib/env";
import {
  GOOGLE_AUTH_DISCLOSURE,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
} from "@/lib/branding";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";

export default function PrivacyPolicy() {
  const supportEmail = getSupportEmail();

  return (
    <LegalDocumentPage
      title="Privacy Policy"
      footerNote="This is a structural privacy policy stub. A full legal review is recommended before external OAuth verification."
    >
      <section>
        <h2 className="text-lg font-semibold text-foreground">About {PRODUCT_NAME}</h2>
        <p className="mt-2">
          {PRODUCT_DESCRIPTION} This policy describes how we collect and use information when you use {PRODUCT_NAME}.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Information we collect</h2>
        <p className="mt-2">
          When you create an account, we collect your email address and, if you choose email registration,
          your name and password. When you sign in with Google, we receive your basic profile information
          (name and email address) from Google to identify your account.
        </p>
        <p className="mt-2">{GOOGLE_AUTH_DISCLOSURE}</p>
        <p className="mt-2">
          During financial onboarding, we collect additional profile information such as age range, income,
          expenses, risk profile, investment horizon, and financial goals to personalise your experience.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">How we use your information</h2>
        <p className="mt-2">
          We use your information to authenticate your account, provide educational financial analysis,
          paper trading features, and personalised onboarding. We do not sell your personal information.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-foreground">Contact</h2>
        <p className="mt-2">
          For privacy-related questions, contact us at{" "}
          <a href={`mailto:${supportEmail}`} className="text-primary underline underline-offset-2">
            {supportEmail}
          </a>
          .
        </p>
      </section>
    </LegalDocumentPage>
  );
}
