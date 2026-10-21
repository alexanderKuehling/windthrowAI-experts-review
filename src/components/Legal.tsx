import { useEffect } from "react"

export type LegalPage = "imprint" | "privacy"

interface LegalModalProps {
  page: LegalPage
  onClose: () => void
}

const CONTACT = "akueh@mail.bgc-jena.mpg.de"

export function LegalModal({ page, onClose }: LegalModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [onClose])

  return (
    <div className="legal-overlay" onClick={onClose}>
      <div
        className="legal-panel"
        role="dialog"
        aria-modal="true"
        aria-label={page === "imprint" ? "Imprint" : "Data protection information"}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="legal-panel-head">
          <h2>{page === "imprint" ? "Imprint" : "Data protection information"}</h2>
          <button className="legal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </header>
        <div className="legal-body">
          {page === "imprint" ? <Imprint /> : <Privacy />}
        </div>
      </div>
    </div>
  )
}

function Mail() {
  return <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
}

function Imprint() {
  return (
    <>
      <p>
        The following provides mandatory data concerning the service provider of this website,
        obligations with regard to data protection, as well as other important legal references
        involving the Internet site of the Max Planck Institute for Biogeochemistry
        (www.bgc-jena.mpg.de) as required by German law.
      </p>

      <h3>Service Provider</h3>
      <p>
        The Max-Planck-Gesellschaft zur Förderung der Wissenschaften e.V.
        <br />
        Hofgartenstraße 8
        <br />
        D-80539 Munich
        <br />
        Phone: +49 (89) 2108 - 0
        <br />
        Internet:{" "}
        <a href="https://www.mpg.de" target="_blank" rel="noreferrer">
          www.mpg.de
        </a>
      </p>
      <p>
        is the Service Provider of this website of the EarthNet Team at the Max Planck Institute
        for Biogeochemistry.
      </p>

      <h3>Register of Societies and Associations</h3>
      <p>
        The Max-Planck-Gesellschaft zur Förderung der Wissenschaften e.V. (Max Planck Society) is
        registered in the Official Register of Societies and Associations at Berlin-Charlottenburg
        Local Court under the register number VR 13378 B.
      </p>

      <h3>Representatives</h3>
      <p>
        The Max Planck Society is legally represented by its Board of Directors which, in turn, is
        represented by the President of the Society, Prof. Dr. Patrick Cramer and by Secretary
        General Dr. Simone Schwanitz.
      </p>

      <h3>Value Added Tax Identification Number</h3>
      <p>The value added tax identification number of the Max Planck Society is DE 129517720.</p>

      <h3>Editors</h3>
      <p>
        Responsible editor for the contents of the website of the Max Planck Institute for
        Biogeochemistry with regard to media law is the Director, Prof. Dr. Markus Reichstein.
      </p>

      <h3>Editor contact</h3>
      <p>
        EarthNet Team, Department Biogeochemical Integration
        <br />
        Max Planck Institute for Biogeochemistry
        <br />
        Hans-Knöll-Str. 10
        <br />
        07745 Jena, Germany
        <br />
        <a href="mailto:earthnet@bgc-jena.mpg.de">earthnet@bgc-jena.mpg.de</a>
      </p>

      <h3>Legal Structure</h3>
      <p>
        The Max Planck Society is a non-profit research facility which is organized as a registered
        association. All of the institutes and facilities of the Max Planck Society are largely
        autonomous in terms of organization and research, but as a rule have no legal capacity of
        their own.
      </p>

      <h3>Foreign Language Pages</h3>
      <p>
        To the extent that parts of this Internet site are offered in languages other than German,
        this represents a service exclusively for staff and guests of the Max Planck Society who are
        not proficient in German.
      </p>

      <h3>Liability for Contents of Online Information</h3>
      <p>
        As the provider of contents in accordance with Section 7 Paragraph 1 of the
        Digitale-Dienste-Gesetz (German Digital Service Act), the Max Planck Society shall be
        responsible for any contents which it makes available for use in accordance with general
        legal provisions. The Max Planck Society makes every effort to provide timely and accurate
        information on this Web site. Nevertheless, errors and inaccuracies cannot be completely
        ruled out. Therefore, the Max Planck Society does not assume any liability for the
        relevance, accuracy, completeness or quality of the information provided. The Max Planck
        Society shall not be liable for damage of a tangible or intangible nature caused directly or
        indirectly through the use or failure to use the information offered and/or through the use
        of faulty or incomplete information unless it is verifiably culpable of intent or gross
        negligence. The same shall apply to any downloadable software available free of charge. The
        Max Planck Society reserves the right to modify, supplement, or delete any or all of the
        information offered on its Internet site, or to temporarily or permanently cease publication
        thereof without prior and separate notification.
      </p>

      <h3>Links to Internet Sites of Third Parties</h3>
      <p>
        This Internet site includes links to external pages. The respective provider shall be
        responsible for the contents of any linked external pages. In establishing the initial link,
        the Max Planck Society has reviewed the respective external content in order to determine
        whether such link entailed possible civil or criminal responsibility. However, a constant
        review of linked external pages is unreasonable without concrete reason to believe that a
        violation of the law may be involved. If the Max Planck Society determines such or it is
        pointed out by others that an external offer to which it is connected via a link entails
        civil or criminal responsibility, then the Max Planck Society will immediately eliminate any
        link to this offer. The Max Planck Society expressly dissociates itself from such contents.
      </p>

      <h3>Copyright</h3>
      <p>
        The layout, graphics employed and any other contents on the homepage of the EarthNet team
        Internet site are protected by copyright law.
        <br />© Max-Planck-Gesellschaft zur Förderung der Wissenschaften e.V., Munich. All rights
        reserved.
      </p>
    </>
  )
}

function Privacy() {
  return (
    <>
      <p>
        The Max-Planck-Gesellschaft zur Förderung der Wissenschaften e.V. (MPG) takes the protection
        of your personal data very seriously. We process personal data gathered when you visit and
        use this web application (the "Tool") in compliance with the applicable data protection
        legislation and, as a matter of principle, only to the extent that this is necessary to
        provide a functioning application and our content and services. We neither publish your data
        nor transmit them to third parties on an unauthorized basis. In the following sections, we
        explain which data we record when you visit and use the Tool, and how exactly they are
        utilized.
      </p>

      <h3>A. Provision of the website (hosting via GitHub Pages)</h3>

      <h4>1. Visiting the website</h4>
      <p>
        <strong>a. Type of data</strong>
        <br />
        The Tool's front end is delivered via GitHub Pages, a service of GitHub, Inc., 88 Colin P.
        Kelly Jr. Street, San Francisco, CA 94107, USA (a subsidiary of Microsoft Corporation). Each
        time you visit the Tool, GitHub automatically records technical data and information from the
        system of the visiting device, including:
      </p>
      <ul>
        <li>Your IP address</li>
        <li>Date and time of your access</li>
        <li>Address of the page visited</li>
        <li>Address of the previously visited website (referrer)</li>
        <li>Name and version of your browser/operating system (if transmitted)</li>
      </ul>
      <p>
        These data are stored in GitHub's server log files for the purpose of delivering the website
        and ensuring its security. The Tool's operators have no access to these raw log files.
        Details can be found in GitHub's privacy statement:{" "}
        <a href="https://docs.github.com/privacy" target="_blank" rel="noreferrer">
          https://docs.github.com/privacy
        </a>
      </p>
      <p>
        <strong>b. Legal basis</strong>
        <br />
        The legal basis for this processing is Article 6 (1) lit. f GDPR. The recording of data for
        the provision of the website is essential to operate the Tool. It is therefore not possible
        for the user to object.
      </p>
      <p>
        <strong>c. Data deletion</strong>
        <br />
        Deletion of these log data is carried out by GitHub in accordance with its own retention
        policies (see GitHub's privacy statement). Unlike websites hosted on MPG servers, the MPG
        cannot guarantee a specific deletion period for these logs.
      </p>

      <h4>2. Technically necessary browser storage</h4>
      <p>
        <strong>a. Type of data</strong>
        <br />
        The Tool stores technically necessary information in your browser (cookies, Local Storage
        and/or IndexedDB), in particular:
      </p>
      <ul>
        <li>Your session token, so that you remain signed in while using the Tool</li>
      </ul>
      <p>No advertising or cross-site tracking cookies are used.</p>
      <p>
        <strong>b. Legal basis</strong>
        <br />
        The legal basis is Art. 6 (1) lit. f GDPR as well as § 25 para. 2 no. 2 TDDDG. The sign-in
        functionality cannot be offered without this storage; it is strictly necessary for the
        service explicitly requested by the user.
      </p>
      <p>
        <strong>c. Data deletion</strong>
        <br />
        The stored tokens are invalidated/removed when you sign out; you can additionally delete them
        at any time via your browser settings (clear site data).
      </p>

      <h3>B. Registration and user account (username/password)</h3>
      <p>
        <strong>a. Type of data</strong>
        <br />
        A user account is needed to appear on the leaderboard and to keep your channel presets across
        devices. The review features (rating and correcting model output) can also be used without an
        account, in guest mode (see Section D).
        Registration and sign-in are handled by the Tool's own authentication system; no external
        identity provider is used. The following data are processed:
      </p>
      <ul>
        <li>Your chosen username</li>
        <li>
          Your password, which is stored exclusively in hashed form (salted, using HMAC); the
          plain-text password is never stored
        </li>
        <li>
          Technical data of the sign-in process (IP address, timestamps), processed to secure
          authentication and prevent misuse
        </li>
      </ul>
      <p>
        No email address or other contact details are collected during registration (data
        minimization). For this reason, a forgotten password cannot be reset via email.
      </p>
      <p>
        Account data (username, password hash) are stored in Google Cloud Firestore (Google Ireland
        Ltd., Gordon House, Barrow Street, Dublin 4, Ireland; parent company: Google LLC, USA).
      </p>
      <p>
        <strong>b. Legal basis</strong>
        <br />
        The legal basis is Art. 6 (1) lit. b GDPR (performance of the service requested by the user).
      </p>
      <p>
        <strong>c. Data deletion</strong>
        <br />
        Account data are deleted when your account is deleted (see Section H).
      </p>

      <h3>C. Username, score and leaderboard</h3>
      <p>
        <strong>a. Type of data</strong>
        <br />
        To provide the gamified review experience, the Tool stores your chosen username, your
        score/points and related activity statistics. These data are stored in Google Cloud
        Firestore (see Section B).
      </p>
      <p>
        <strong>Note:</strong> Your username and score are visible to other users of the Tool on the
        leaderboard. Please choose a pseudonym if you do not wish to be identifiable.
      </p>
      <p>
        <strong>b. Legal basis</strong>
        <br />
        The legal basis is Art. 6 (1) lit. b GDPR.
      </p>
      <p>
        <strong>c. Data deletion</strong>
        <br />
        These data are deleted and the username will be removed from the leaderboard when your
        account is deleted. To request a deletion write <Mail />.
      </p>

      <h3>D. Your contributions (ratings and mask corrections)</h3>
      <p>
        <strong>a. Type of data</strong>
        <br />
        When you use the Tool, your ratings (accept/reject decisions on model detections) and your
        corrections of segmentation masks, together with timestamps, are stored and linked to your
        user account. In guest mode they are stored without a username and are not linked to any
        account, and they do not appear on the leaderboard.
      </p>
      <p>
        <strong>b. Purpose</strong>
        <br />
        The contributions are used for scientific research purposes, namely the validation of an AI
        model for the detection of windthrow (storm-felled forest areas) in satellite imagery, and
        for the improvement of this model and its training data.
      </p>
      <p>
        <strong>c. Legal basis</strong>
        <br />
        The legal basis is Art. 6 (1) lit. b GDPR; further processing for scientific research
        purposes is based on Art. 6 (1) lit. f GDPR in conjunction with the safeguards of Art. 89 (1)
        GDPR.
      </p>
      <p>
        <strong>d. Publication as research data</strong>
        <br />
        The ratings and mask corrections collected via the Tool may be published or shared as part of
        scientific publications and research datasets. Any such publication takes place exclusively
        in anonymized or aggregated form: your username, your internal user ID and any other
        information that could identify you are removed beforehand, so that published datasets no
        longer contain personal data.
      </p>
      <p>
        <strong>e. Data deletion</strong>
        <br />
        Upon deletion of your account, your contributions are decoupled from your account and
        retained in anonymized form for research purposes. Contributions made in guest mode cannot be
        attributed to you afterwards, so they cannot be deleted individually on request.
      </p>

      <h3>E. Satellite map tiles (Google Cloud Run / Google Earth Engine)</h3>
      <p>
        <strong>a. Type of data</strong>
        <br />
        The satellite imagery shown in the Tool is loaded as map tiles from a backend service
        operated on Google Cloud Run, which retrieves data via Google Earth Engine (Google Ireland
        Ltd. / Google LLC, USA). When tiles are loaded, your IP address and technical request data
        are transmitted to Google for the purpose of delivering the imagery.
      </p>
      <p>
        <strong>b. Legal basis</strong>
        <br />
        The legal basis is Art. 6 (1) lit. b and lit. f GDPR (provision of the core functionality of
        the Tool).
      </p>
      <p>
        <strong>c. Data deletion</strong>
        <br />
        Request logs are retained according to the configured logging policy of the backend service.
      </p>

      <h3>F. Data transmission, processors and third-country transfers</h3>
      <p>
        The management and storage of personal data described above is carried out within the scope
        of commissioned data processing (Art. 28 GDPR) on systems of the following service providers:
      </p>
      <ul>
        <li>GitHub, Inc. (USA) – hosting of the front end</li>
        <li>
          Google Ireland Ltd. / Google LLC (Ireland/USA) – account, score and contribution storage
          (Firestore), authentication backend and map tiles (Cloud Run / Earth Engine)
        </li>
        <li>Hugging Face, Inc. (USA) – model and dataset hosting</li>
      </ul>
      <p>
        These providers may process personal data (in particular IP addresses and account data) in
        the United States. Such transfers are based on the adequacy decision for the EU–US Data
        Privacy Framework (Art. 45 GDPR), insofar as the respective provider is certified, and
        otherwise on EU Standard Contractual Clauses (Art. 46 (2) lit. c GDPR).
      </p>
      <p>
        Beyond this, your personal data are only transmitted to public institutions and authorities
        if legally required or for the purpose of criminal prosecution due to attacks on our network
        infrastructure. The data are not shared with third parties for any other purposes; in
        particular, they are not sold or used for advertising.
      </p>

      <h3>G. General details</h3>
      <p>
        <strong>1. Contact details of the controller</strong>
        <br />
        The controller within the meaning of the General Data Protection Regulation and other
        national data protection acts as well as other data protection legislation is the
      </p>
      <p>
        Max-Planck-Gesellschaft zur Förderung der Wissenschaften e.V. (MPG)
        <br />
        Hofgartenstrasse 8
        <br />
        D-80539 Munich, Germany
        <br />
        Telephone: +49 (89) 2108-0
        <br />
        Contact form:{" "}
        <a href="https://www.mpg.de/kontakt/anfragen" target="_blank" rel="noreferrer">
          https://www.mpg.de/kontakt/anfragen
        </a>
        <br />
        Internet:{" "}
        <a href="https://www.mpg.de" target="_blank" rel="noreferrer">
          https://www.mpg.de
        </a>
      </p>
      <p>
        Content-related contact for this Tool: Alexander Kuehling, Max Planck Institute for
        Biogeochemistry, Hans-Knöll-Str. 10, 07745 Jena, Germany – <Mail />.
      </p>
      <p>
        <strong>2. Data Protection Officer's contact details</strong>
        <br />
        The controller's Data Protection Officer can be reached as follows:
        <br />
        Data Protection Officer of the MPG, Hofgartenstrasse 8, D-80539 Munich, Germany
        <br />
        Telephone: +49 (89) 2108-1554
        <br />
        <a href="mailto:datenschutz@mpg.de">datenschutz@mpg.de</a>
      </p>

      <h3>H. Deleting your account</h3>
      <p>
        You can request the deletion of your account and the associated personal data at any time via{" "}
        <Mail />. Sections C–D describe what happens to leaderboard entries and contributions upon
        deletion.
      </p>

      <h3>I. Rights of the data subjects</h3>
      <p>
        As a data subject whose personal data are collected in the context of the above-mentioned
        services, you generally have the following rights unless legal exceptions apply in individual
        cases:
      </p>
      <ul>
        <li>Information (Article 15 GDPR)</li>
        <li>Correction (Article 16 GDPR)</li>
        <li>Deletion (Article 17 (1) GDPR)</li>
        <li>Restriction of processing (Article 18 GDPR)</li>
        <li>Data transmission (Article 20 GDPR)</li>
        <li>Revocation of processing (Article 21 GDPR)</li>
        <li>Revocation of consent (Article 7 (3) GDPR)</li>
        <li>Right to complain to the regulator (Article 77 GDPR)</li>
      </ul>

      <p className="legal-status">Last updated: 22 July 2026 · Version 1.0</p>
    </>
  )
}
