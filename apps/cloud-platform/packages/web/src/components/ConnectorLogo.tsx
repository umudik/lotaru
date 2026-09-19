import { useState } from "react";

const CONNECTOR_DOMAINS: Record<string, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  azuredevops: "dev.azure.com",
  bitbucket: "bitbucket.org",
  linear: "linear.app",
  jira: "atlassian.com",
  clickup: "clickup.com",
  taiga: "taiga.io",
  flow: "getflow.com",
  figma: "figma.com",
  netlify: "netlify.com",
  google: "google.com",
  outlook: "outlook.com",
  onedrive: "onedrive.live.com",
  teams: "teams.microsoft.com",
  slack: "slack.com",
  telegram: "telegram.org",
  whatsapp: "whatsapp.com",
  twilio: "twilio.com",
  webex: "webex.com",
  facebook: "facebook.com",
  facebookleadads: "facebook.com",
  pushcut: "pushcut.io",
  notion: "notion.so",
  airtable: "airtable.com",
  asana: "asana.com",
  trello: "trello.com",
  box: "box.com",
  seatable: "seatable.io",
  calendly: "calendly.com",
  cal: "cal.com",
  clockify: "clockify.me",
  toggl: "toggl.com",
  acuityscheduling: "acuityscheduling.com",
  currents: "currents.dev",
  onfleet: "onfleet.com",
  thehive: "strangebee.com",
  thehive5: "strangebee.com",
  hubspot: "hubspot.com",
  salesforce: "salesforce.com",
  pipedrive: "pipedrive.com",
  mailchimp: "mailchimp.com",
  convertkit: "convertkit.com",
  activecampaign: "activecampaign.com",
  mautic: "mautic.org",
  getresponse: "getresponse.com",
  mailerlite: "mailerlite.com",
  mailjet: "mailjet.com",
  brevo: "brevo.com",
  customerio: "customer.io",
  lemlist: "lemlist.com",
  emelia: "emelia.io",
  autopilot: "ortto.com",
  affinity: "affinity.co",
  copper: "copper.com",
  keap: "keap.com",
  lonescale: "lonescale.com",
  helpscout: "helpscout.com",
  workable: "workable.com",
  zendesk: "zendesk.com",
  stripe: "stripe.com",
  shopify: "shopify.com",
  woocommerce: "woocommerce.com",
  paypal: "paypal.com",
  gumroad: "gumroad.com",
  chargebee: "chargebee.com",
  wise: "wise.com",
  invoiceninja: "invoiceninja.com",
  eventbrite: "eventbrite.com",
  strava: "strava.com",
  typeform: "typeform.com",
  jotform: "jotform.com",
  formio: "form.io",
  formstack: "formstack.com",
  wufoo: "wufoo.com",
  surveymonkey: "surveymonkey.com",
  kobotoolbox: "kobotoolbox.org",
  webflow: "webflow.com",
  amqp: "amqp.org",
  kafka: "kafka.apache.org",
  mqtt: "mqtt.org",
  rabbitmq: "rabbitmq.com",
  redis: "redis.io",
  postgres: "postgresql.org",
  "aws.sns": "aws.amazon.com",
  rss: "rss.com",
  "venafi.cloud": "venafi.com",
  "venafi.datacenter": "venafi.com",
  postmark: "postmarkapp.com",
  ollama: "ollama.com",
  lmstudio: "lmstudio.ai",
  llamacpp: "ggml.ai",
  openai: "openai.com",
  anthropic: "anthropic.com",
  groq: "groq.com",
  openrouter: "openrouter.ai",
  mistral: "mistral.ai",
  deepseek: "deepseek.com",
  gemini: "google.com",
  cursor: "cursor.com",
  claude: "anthropic.com",
  codex: "openai.com",
};

function domainFor(connectorId: string): string {
  const listed = CONNECTOR_DOMAINS[connectorId];
  if (listed === undefined) {
    return "";
  }
  return listed;
}

function glyphFor(label: string): string {
  for (const ch of label) {
    if (ch.trim().length > 0) {
      return ch.toUpperCase();
    }
  }
  return "?";
}

export function ConnectorLogo(props: {
  id: string;
  label: string;
  eager: boolean;
  size?: "sm" | "md";
}): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const domain = domainFor(props.id);
  const glyph = glyphFor(props.label);
  const compact = props.size === "sm";
  const boxClass = compact
    ? "grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-md"
    : "grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-lg";
  const imgPx = compact ? 14 : 18;
  if (domain.length === 0 || broken) {
    return (
      <span className={`${boxClass} bg-secondary text-[11px] font-semibold`}>
        {glyph}
      </span>
    );
  }
  const src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
  return (
    <span className={`${boxClass} bg-white`}>
      <img
        src={src}
        alt=""
        width={imgPx}
        height={imgPx}
        decoding="async"
        loading={props.eager ? undefined : "lazy"}
        className={compact ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"}
        onError={() => {
          setBroken(true);
        }}
      />
    </span>
  );
}
