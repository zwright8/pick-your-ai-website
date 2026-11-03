/*
 * Privacy and terms. Styled with the design mock's masthead + chapter treatment; the wording is
 * the project's plain-language notice for the configured data and build-storage modes.
 */
import { PageHeader } from '../components/layout';
import { Notice } from '../components/feedback';
import { useData } from '../app/data-context';

const SITE_REPO = 'https://github.com/Pick-Your-AI/pickyour.ai';

export default function LegalPage() {
  const { mode, buildStore } = useData();
  return (
    <div className="app-page">
      <PageHeader compact breadcrumb="LEGAL" eyebrow="LEGAL" title="Privacy and terms">
        A plain-language notice for the PickYour.AI preview. Last updated{' '}
        <time dateTime="2026-11-03">2026-11-03</time>.
      </PageHeader>
      <div className="container legal-content">
        <Notice title="Preview notice.">
          {mode === 'fixture'
            ? 'This page describes how the fixture preview works today.'
            : 'This deployment uses a configured API. Its operator controls the API service and its data handling.'}
        </Notice>

        <section className="method-chapter" aria-labelledby="privacy">
          <div className="chapter-index">01 / PRIVACY</div>
          <h2 id="privacy">Privacy</h2>
          <ul className="legal-list">
            <li>
              <strong>No accounts.</strong> You do not sign up or sign in.
            </li>
            <li>
              <strong>No cookies, analytics or trackers.</strong> The site loads no analytics,
              advertising or third-party scripts. Typefaces are self-hosted.
              {mode === 'http'
                ? ' Catalog and analysis requests go to the configured API, which may be on another origin.'
                : ' The fixture preview makes no requests to another origin.'}
            </li>
            <li>
              {buildStore === 'local' ? (
                <>
                  <strong>Build snapshots are saved in this browser.</strong> Build snapshots and
                  preferences such as the colour theme are saved in local storage under keys
                  starting with <code className="mono">pyai.</code>; clearing site data removes
                  these local copies.
                </>
              ) : (
                <>
                  <strong>Build snapshots are sent to the configured API.</strong> The browser also
                  keeps a local cache and library index under keys starting with{' '}
                  <code className="mono">pyai.</code>; removing a library entry deletes the browser
                  copy, not the API copy. The API operator controls remote access and retention.
                </>
              )}
              {mode === 'http'
                ? ' The configured API receives build identifiers and revisions for compatibility and cost requests; those requests can also include analysis identifiers and parameters.'
                : ''}
            </li>
            <li>
              <strong>Share links carry the build in the URL fragment</strong> (the part after{' '}
              <code className="mono">#</code>). Browsers do not send the fragment to the web server.
              Anyone with the link can view the build.
              {mode === 'http'
                ? ' Analysis requests can send the shared build’s identifier and revision to the configured API.'
                : ''}
            </li>
            <li>
              <strong>Server logs.</strong> Like most websites, the hosting provider&apos;s web
              servers may record standard request logs, such as IP address, user agent, requested
              page and time, for operation and security.
            </li>
          </ul>
        </section>

        <section className="method-chapter" aria-labelledby="terms">
          <div className="chapter-index">02 / TERMS OF USE</div>
          <h2 id="terms">Terms of use</h2>
          <ul className="legal-list">
            <li>
              The preview is provided <strong>as is, without warranty</strong> of any kind. It may
              change or be unavailable at any time.
            </li>
            <li>
              {mode === 'fixture' ? (
                <>
                  The demo data is <strong>synthetic</strong>.{' '}
                </>
              ) : (
                <>Catalog records may include synthetic data; check their labels and provenance. </>
              )}
              Nothing on the site is advice, a recommendation or a price quote. Verify anything
              important with the relevant vendor before you rely on it.
            </li>
            <li>
              PickYour.AI is independent. Naming a vendor or product in future catalog data does not
              imply any affiliation, sponsorship or endorsement.
            </li>
            <li>
              The website source code is available under the{' '}
              <a className="text-link" href={`${SITE_REPO}/blob/main/LICENSE`}>
                MIT licence
              </a>
              .
            </li>
          </ul>
        </section>

        <section className="method-chapter" aria-labelledby="contact">
          <div className="chapter-index">03 / CONTACT</div>
          <h2 id="contact">Contact</h2>
          <p>
            For questions about this notice, open an issue on{' '}
            <a className="text-link" href={`${SITE_REPO}/issues`}>
              the website&apos;s GitHub issue tracker
            </a>
            . Please do not post personal information there.
          </p>
        </section>
      </div>
    </div>
  );
}
