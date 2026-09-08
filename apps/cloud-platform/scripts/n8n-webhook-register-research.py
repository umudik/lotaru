import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

N8N_RAW = "https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/"

PATHS = {
    "github": "Github/GithubTrigger.node.ts",
    "activecampaign": "ActiveCampaign/ActiveCampaignTrigger.node.ts",
    "acuityscheduling": "AcuityScheduling/AcuitySchedulingTrigger.node.ts",
    "affinity": "Affinity/AffinityTrigger.node.ts",
    "airtable": "Airtable/AirtableTrigger.node.ts",
    "amqp": "Amqp/AmqpTrigger.node.ts",
    "asana": "Asana/AsanaTrigger.node.ts",
    "autopilot": "Autopilot/AutopilotTrigger.node.ts",
    "aws.sns": "Aws/AwsSnsTrigger.node.ts",
    "bitbucket": "Bitbucket/BitbucketTrigger.node.ts",
    "box": "Box/BoxTrigger.node.ts",
    "brevo": "Brevo/BrevoTrigger.node.ts",
    "cal": "Cal/CalTrigger.node.ts",
    "calendly": "Calendly/CalendlyTrigger.node.ts",
    "chargebee": "Chargebee/ChargebeeTrigger.node.ts",
    "clickup": "ClickUp/ClickUpTrigger.node.ts",
    "clockify": "Clockify/ClockifyTrigger.node.ts",
    "convertkit": "ConvertKit/ConvertKitTrigger.node.ts",
    "copper": "Copper/CopperTrigger.node.ts",
    "currents": "Currents/CurrentsTrigger.node.ts",
    "customerio": "CustomerIo/CustomerIoTrigger.node.ts",
    "emelia": "Emelia/EmeliaTrigger.node.ts",
    "eventbrite": "Eventbrite/EventbriteTrigger.node.ts",
    "facebook": "Facebook/FacebookTrigger.node.ts",
    "facebookleadads": "FacebookLeadAds/FacebookLeadAdsTrigger.node.ts",
    "figma": "Figma/FigmaTrigger.node.ts",
    "flow": "Flow/FlowTrigger.node.ts",
    "formio": "FormIo/FormIoTrigger.node.ts",
    "formstack": "Formstack/FormstackTrigger.node.ts",
    "getresponse": "GetResponse/GetResponseTrigger.node.ts",
    "gitlab": "Gitlab/GitlabTrigger.node.ts",
    "google": "Google/Gmail/GmailTrigger.node.ts",
    "gumroad": "Gumroad/GumroadTrigger.node.ts",
    "helpscout": "HelpScout/HelpScoutTrigger.node.ts",
    "hubspot": "Hubspot/HubspotTrigger.node.ts",
    "invoiceninja": "InvoiceNinja/InvoiceNinjaTrigger.node.ts",
    "jira": "Jira/JiraTrigger.node.ts",
    "jotform": "JotForm/JotFormTrigger.node.ts",
    "kafka": "Kafka/KafkaTrigger.node.ts",
    "keap": "Keap/KeapTrigger.node.ts",
    "kobotoolbox": "KoBoToolbox/KoBoToolboxTrigger.node.ts",
    "lemlist": "Lemlist/LemlistTrigger.node.ts",
    "linear": "Linear/LinearTrigger.node.ts",
    "lonescale": "LoneScale/LoneScaleTrigger.node.ts",
    "mailchimp": "Mailchimp/MailchimpTrigger.node.ts",
    "mailerlite": "MailerLite/MailerLiteTrigger.node.ts",
    "mailjet": "Mailjet/MailjetTrigger.node.ts",
    "mautic": "Mautic/MauticTrigger.node.ts",
    "mqtt": "MQTT/MqttTrigger.node.ts",
    "netlify": "Netlify/NetlifyTrigger.node.ts",
    "notion": "Notion/NotionTrigger.node.ts",
    "onedrive": "Microsoft/OneDrive/MicrosoftOneDriveTrigger.node.ts",
    "onfleet": "Onfleet/OnfleetTrigger.node.ts",
    "outlook": "Microsoft/Outlook/MicrosoftOutlookTrigger.node.ts",
    "paypal": "PayPal/PayPalTrigger.node.ts",
    "pipedrive": "Pipedrive/PipedriveTrigger.node.ts",
    "postgres": "Postgres/PostgresTrigger.node.ts",
    "postmark": "Postmark/PostmarkTrigger.node.ts",
    "pushcut": "Pushcut/PushcutTrigger.node.ts",
    "rabbitmq": "RabbitMQ/RabbitMQTrigger.node.ts",
    "redis": "Redis/RedisTrigger.node.ts",
    "rss": "RssFeedRead/RssFeedReadTrigger.node.ts",
    "salesforce": "Salesforce/SalesforceTrigger.node.ts",
    "seatable": "SeaTable/SeaTableTrigger.node.ts",
    "shopify": "Shopify/ShopifyTrigger.node.ts",
    "slack": "Slack/SlackTrigger.node.ts",
    "strava": "Strava/StravaTrigger.node.ts",
    "stripe": "Stripe/StripeTrigger.node.ts",
    "surveymonkey": "SurveyMonkey/SurveyMonkeyTrigger.node.ts",
    "taiga": "Taiga/TaigaTrigger.node.ts",
    "teams": "Microsoft/Teams/MicrosoftTeamsTrigger.node.ts",
    "telegram": "Telegram/TelegramTrigger.node.ts",
    "thehive": "TheHive/TheHiveTrigger.node.ts",
    "thehive5": "TheHiveProject/TheHiveProjectTrigger.node.ts",
    "toggl": "Toggl/TogglTrigger.node.ts",
    "trello": "Trello/TrelloTrigger.node.ts",
    "twilio": "Twilio/TwilioTrigger.node.ts",
    "typeform": "Typeform/TypeformTrigger.node.ts",
    "venafi.cloud": "Venafi/ProtectCloud/VenafiTlsProtectCloudTrigger.node.ts",
    "venafi.datacenter": "Venafi/Datacenter/VenafiTlsProtectDatacenterTrigger.node.ts",
    "webex": "Cisco/Webex/CiscoWebexTrigger.node.ts",
    "webflow": "Webflow/WebflowTrigger.node.ts",
    "whatsapp": "WhatsApp/WhatsAppTrigger.node.ts",
    "wise": "Wise/WiseTrigger.node.ts",
    "woocommerce": "WooCommerce/WooCommerceTrigger.node.ts",
    "workable": "Workable/WorkableTrigger.node.ts",
    "wufoo": "Wufoo/WufooTrigger.node.ts",
    "zendesk": "Zendesk/ZendeskTrigger.node.ts",
}

BROKER_IDS = {"amqp", "kafka", "mqtt", "postgres", "rabbitmq", "redis"}

VENDOR_HINTS = (
    "apiRequest",
    "httpRequest",
    "helpers.request",
    "/hooks",
    "/webhooks",
    "webhookCreate",
    "subscriptions",
    "webhook_endpoints",
    "rest/webhooks",
    "sns.subscribe",
    "SubscribeCommand",
)

PASTE_HINTS = (
    "manually",
    "dashboard",
    "copy the url",
    "paste",
    "request url",
    "you have to",
    "set this url",
    "add the url",
)


def fetch_text(rel: str) -> str:
    url = N8N_RAW + rel
    req = urllib.request.Request(url, headers={"User-Agent": "LotaruResearch"})
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.read().decode("utf-8", errors="replace")
    except Exception as exc:
        return f"FETCH_ERROR {exc}"


def create_chunk(text: str) -> str:
    match = re.search(r"async create\s*\(", text)
    if match is None:
        match = re.search(r"create:\s*async\s*\(", text)
    if match is None:
        return ""
    return text[match.start() : match.start() + 5000]


def classify(connector_id: str, rel: str, text: str) -> str:
    if text.startswith("FETCH_ERROR"):
        return "n8n-file-missing"
    if connector_id in BROKER_IDS:
        return "broker-listen"
    has_methods = "webhookMethods" in text
    has_poll = "async poll(" in text
    if has_poll and has_methods is not True:
        return "poll"
    if has_methods is not True:
        if has_poll:
            return "poll"
        return "unknown"
    chunk = create_chunk(text)
    vendor = False
    for hint in VENDOR_HINTS:
        if hint in chunk or hint in text:
            if hint in chunk:
                vendor = True
                break
    paste = False
    lowered = text.lower()
    for hint in PASTE_HINTS:
        if hint in lowered:
            paste = True
            break
    if vendor:
        return "same-key-register"
    if paste:
        return "vendor-paste-or-verify"
    return "n8n-hosts-url"


def main() -> None:
    rows = []
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {
            pool.submit(fetch_text, rel): (cid, rel) for cid, rel in PATHS.items()
        }
        for fut in as_completed(futures):
            cid, rel = futures[fut]
            text = fut.result()
            family = classify(cid, rel, text)
            extra = ""
            if cid == "google":
                extra = "Also Calendar/Drive/Sheets/BusinessProfile triggers in n8n."
            rows.append(
                {
                    "id": cid,
                    "n8nPath": rel,
                    "n8nUrl": "https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/"
                    + rel,
                    "family": family,
                    "hasWebhookMethods": "webhookMethods" in text,
                    "hasPoll": "async poll(" in text,
                    "fetchError": text.startswith("FETCH_ERROR"),
                    "extra": extra,
                }
            )
    rows.sort(key=lambda row: (row["family"], row["id"]))
    counts = {}
    for row in rows:
        counts[row["family"]] = counts.get(row["family"], 0) + 1
    out = {"counts": counts, "connectors": rows}
    dest = os.path.join(os.path.dirname(__file__), "n8n-webhook-register-research.json")
    with open(dest, "w", encoding="utf-8") as handle:
        json.dump(out, handle, indent=2)
    print(json.dumps(counts, indent=2))
    print("wrote", dest, "rows", len(rows))


if __name__ == "__main__":
    main()
