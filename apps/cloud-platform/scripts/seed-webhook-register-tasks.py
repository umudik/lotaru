import json
import os
import re
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "http://127.0.0.1:2222"
PROJECT_ID = "01a01702-5291-7782-b810-114969279c82"
N8N_RAW = "https://raw.githubusercontent.com/n8n-io/n8n/master/packages/nodes-base/nodes/"
AUTH = {"Authorization": "Bearer local", "Content-Type": "application/json"}

POLL_ADAPTERS = {"github", "jira", "linear", "notion", "rss", "stripe"}
NATIVE_PARSE = {"github", "jira", "linear", "notion", "slack", "stripe"}
AUTO_REGISTER = {"github", "linear", "stripe"}
CATALOG_POLL = {"github", "google", "jira", "linear", "notion", "outlook", "rss", "stripe"}
CATALOG_WEBHOOK = {"slack"}

FORCE_FAMILY = {
    "jira": "same-key-register",
    "aws.sns": "same-key-register",
    "clickup": "same-key-register",
    "slack": "vendor-paste-or-verify",
    "notion": "poll",
}

VENDOR_DOCS = {
    "github": "https://docs.github.com/en/rest/repos/webhooks",
    "gitlab": "https://docs.gitlab.com/api/projects/#add-a-hook",
    "box": "https://developer.box.com/reference/post-webhooks/",
    "jira": "https://developer.atlassian.com/server/jira/platform/webhooks/",
    "linear": "https://developers.linear.app/docs/graphql/webhooks",
    "stripe": "https://docs.stripe.com/api/webhook_endpoints",
    "slack": "https://docs.slack.dev/apis/events-api/using-http-request-urls",
    "notion": "https://developers.notion.com/reference/webhooks",
    "aws.sns": "https://docs.aws.amazon.com/sns/latest/api/API_Subscribe.html",
    "telegram": "https://core.telegram.org/bots/api#setwebhook",
    "hubspot": "https://developers.hubspot.com/docs/api-reference/webhooks-webhooks-v3/guide",
    "shopify": "https://shopify.dev/docs/api/webhooks",
    "typeform": "https://www.typeform.com/developers/webhooks/",
    "zendesk": "https://developer.zendesk.com/api-reference/event-connectors/webhooks/webhooks/",
    "trello": "https://developer.atlassian.com/cloud/trello/guides/rest-api/webhooks/",
    "asana": "https://developers.asana.com/docs/webhooks",
    "bitbucket": "https://developer.atlassian.com/cloud/bitbucket/rest/api-group-webhooks/",
    "paypal": "https://developer.paypal.com/docs/api/webhooks/v1/",
    "woocommerce": "https://woocommerce.github.io/woocommerce-rest-api-docs/#webhooks",
    "clickup": "https://clickup.com/api/clickupreference/operation/CreateWebhook/",
    "twilio": "https://www.twilio.com/docs/usage/webhooks",
    "facebook": "https://developers.facebook.com/docs/graph-api/webhooks",
    "whatsapp": "https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks",
    "webex": "https://developer.webex.com/docs/api/guides/webhooks",
    "teams": "https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions",
    "outlook": "https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions",
    "google": "https://developers.google.com/gmail/api/guides/push",
    "airtable": "https://airtable.com/developers/web/api/webhooks-overview",
    "salesforce": "https://developer.salesforce.com/docs/atlas.en-us.api_streaming.meta/api_streaming/",
    "rss": "https://www.rssboard.org/rss-specification",
}

SEED_NOTES = {
    "github": "Lotaru already auto-registers via github-hooks.ts. Confirm n8n still matches POST /repos/{owner}/{repo}/hooks.",
    "linear": "Lotaru already auto-registers via inbound-hooks.ts GraphQL webhookCreate. Confirm resourceTypes list vs n8n.",
    "stripe": "Lotaru already auto-registers POST /v1/webhook_endpoints enabled_events=*. Confirm n8n event list vs catalog.",
    "jira": "n8n POSTs classic /rest/webhooks/1.0/webhook (or Jira 10 /rest/jira-webhook/1.0/webhooks) with the same API token. Cloud OAuth2 uses Dynamic Webhooks POST /rest/api/3/webhook. Lotaru polls + parses, does not register yet.",
    "slack": "n8n create() is a no-op. Notice says set Request URL in the Slack app. Official docs: Events API Request URL must be verified in the dashboard. Bot token cannot CRUD the Request URL. Lotaru already handles url_verification.",
    "notion": "n8n NotionTrigger is poll (query database). Official webhooks: create subscription in Notion UI, POST verification_token, paste into Verify. Lotaru stores the token and parses page events; no API register.",
    "aws.sns": "n8n calls SNS Action=Subscribe with the ingest URL then ConfirmSubscription. Same AWS keys. Not paste-only.",
    "box": "n8n POST /webhooks with address+triggers+target. Box OAuth. Same-key.",
    "clickup": "n8n POST /team/{team_id}/webhook with endpoint+events. Same ClickUp token. HMAC secret comes back on create.",
    "gitlab": "n8n POST /projects/:id/hooks. Same PAT/OAuth as GitHub-style.",
    "telegram": "n8n setWebhook with the bot token. One webhook URL per bot. Same-key.",
    "airtable": "n8n AirtableTrigger is poll. Airtable also has POST webhooks API (7-day expiry, refresh). Research whether the stored PAT can CRUD it.",
    "rss": "Feed poll only. No vendor webhook.",
    "amqp": "Broker consume, not HTTP ingest.",
    "kafka": "Broker consume, not HTTP ingest.",
    "mqtt": "Broker subscribe, not HTTP ingest.",
    "postgres": "LISTEN/NOTIFY or slot, not HTTP ingest.",
    "rabbitmq": "Broker consume, not HTTP ingest.",
    "redis": "Pub/sub or keyspace, not HTTP ingest.",
}


def http_json(method: str, path: str, payload=None):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers=AUTH,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read().decode("utf-8")
            if body == "":
                return {}
            return json.loads(body)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} -> {exc.code} {detail}") from exc


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
    return text[match.start() : match.start() + 4500]


def extract_hint(text: str) -> str:
    if text.startswith("FETCH_ERROR"):
        return text[:180]
    chunk = create_chunk(text)
    if "return true" in chunk and "apiRequest" not in chunk and "httpRequest" not in chunk:
        if "helpers.request" not in chunk and "awsApiRequest" not in chunk:
            if len(re.findall(r"await ", chunk)) <= 1:
                return "n8n create() is a no-op (listen URL only / human paste)"
    paths = re.findall(r"['\"](/[A-Za-z0-9_./{}:?=&%-]+)['\"]", chunk)
    actions = re.findall(r"Action=([A-Za-z]+)", chunk)
    verbs = []
    for token in ("POST", "PUT", "GET", "DELETE"):
        if f"'{token}'" in chunk or f'"{token}"' in chunk or f", '{token}'" in chunk:
            verbs.append(token)
    parts = []
    if actions:
        parts.append("SNS/API Action=" + ",".join(actions[:3]))
    if paths:
        parts.append("paths " + ", ".join(paths[:6]))
    if "apiRequest" in chunk or "httpRequest" in chunk or "helpers.request" in chunk:
        parts.append("vendor HTTP from create()")
    if "webhookCreate" in chunk:
        parts.append("webhookCreate")
    if "setWebhook" in chunk:
        parts.append("setWebhook")
    if "Subscribe" in chunk:
        parts.append("Subscribe")
    if parts:
        return "; ".join(parts)
    notice = re.search(r"Set up a webhook|copy the URL|manually|Request URL|dashboard", text, re.I)
    if notice:
        return "n8n UI notice: human webhook setup"
    if "async poll(" in text:
        return "n8n poll() — no webhookMethods create"
    return "inspect n8n Trigger create()/poll() — heuristic empty"


def catalog_intake(connector_id: str) -> str:
    if connector_id in CATALOG_POLL:
        return "poll"
    if connector_id in CATALOG_WEBHOOK:
        return "webhook"
    return "trigger"


def lotaru_today(connector_id: str) -> str:
    poll = "yes" if connector_id in POLL_ADAPTERS else "no"
    parse = "yes" if connector_id in NATIVE_PARSE else "no (vendor JSON 400s on the generic envelope)"
    register = "yes" if connector_id in AUTO_REGISTER else "no"
    return (
        f"catalog intake={catalog_intake(connector_id)}; "
        f"poll adapter={poll}; native parse={parse}; auto-register={register}"
    )


def family_goal(family: str) -> str:
    if family == "same-key-register":
        return (
            "Prove the stored connection secret can CRUD the vendor webhook (n8n webhookMethods.create). "
            "Cite method+path+scopes. Next slice is inbound-hooks.ts style auto-register + native parse."
        )
    if family == "poll":
        return (
            "Confirm n8n has no webhook register (poll()). Say whether a modern vendor webhook exists anyway. "
            "Next slice is poll-adapters.ts unless a same-key webhook beat poll."
        )
    if family == "broker-listen":
        return (
            "This is a message broker, not an HTTP webhook. Do not invent an ingest URL. "
            "Recommend skip for Lotaru HTTP ingest or a separate broker worker."
        )
    if family == "vendor-paste-or-verify":
        return (
            "Human must paste/verify a URL in a vendor dashboard (second identity). "
            "Document the exact UI path and whether Lotaru can still auto-answer the handshake."
        )
    if family == "n8n-hosts-url":
        return (
            "n8n hosts a URL; create() may be empty or use an unusual helper. "
            "Open the Trigger file and decide same-key vs paste vs handshake."
        )
    return (
        "n8n shape was unclear (methods in another file, or handshake). "
        "Read the Trigger + GenericFunctions and vendor docs, then reclassify."
    )


def build_description(row: dict) -> str:
    connector_id = row["id"]
    family = row["family"]
    extra = row.get("extra") or ""
    seed = SEED_NOTES.get(connector_id, "")
    docs = VENDOR_DOCS.get(connector_id, "search official vendor webhook register docs")
    lines = [
        f"Family: {family}",
        f"Catalog id: {connector_id}",
        f"n8n Trigger: {row['n8nUrl']}",
        f"n8n create/poll hint: {row.get('hint', '')}",
        f"Vendor docs: {docs}",
        f"Lotaru today: {lotaru_today(connector_id)}",
        f"Family goal: {family_goal(family)}",
        "Do not implement adapters in this task. Comment the classification.",
        "Output required: register-mode (same-key | poll | broker | must-manual); vendor method+path if any; same connection secret enough?; recommended next Lotaru slice.",
    ]
    if extra:
        lines.append(extra)
    if seed:
        lines.append(f"Seed from n8n+docs (verify, do not copy blindly): {seed}")
    return "\n".join(lines)


def load_classified() -> list:
    path = os.path.join(os.path.dirname(__file__), "n8n-webhook-register-research.json")
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    rows = payload["connectors"]
    for row in rows:
        forced = FORCE_FAMILY.get(row["id"])
        if forced:
            row["family"] = forced
    return rows


def attach_hints(rows: list) -> None:
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(fetch_text, row["n8nPath"]): row for row in rows}
        for fut in as_completed(futures):
            row = futures[fut]
            text = fut.result()
            row["hint"] = extract_hint(text)
            if row["id"] in FORCE_FAMILY:
                continue
            chunk = create_chunk(text)
            if row["family"] == "n8n-hosts-url":
                vendor = any(
                    token in chunk
                    for token in (
                        "apiRequest",
                        "httpRequest",
                        "helpers.request",
                        "awsApiRequest",
                        "webhookCreate",
                        "Subscribe",
                    )
                )
                if vendor:
                    row["family"] = "same-key-register"
            if row["family"] == "unknown":
                if "async poll(" in text:
                    row["family"] = "poll"
                elif "webhookMethods" in text:
                    row["family"] = "n8n-hosts-url"


def post_epic():
    raise RuntimeError("epic already seeded; use existing parent")


def post_task(parent_id: int, title: str, description: str):
    return http_json(
        "POST",
        "/api/tasks",
        {
            "parentId": parent_id,
            "title": title[:200],
            "description": description,
        },
    )


def main() -> None:
    rows = load_classified()
    attach_hints(rows)
    families = {}
    for row in rows:
        families.setdefault(row["family"], []).append(row)
    print("families", {key: len(value) for key, value in sorted(families.items())})
    epic_id = 3
    workflow_parent_id = 4
    print("epic", epic_id, "parent", workflow_parent_id)
    family_ids = {}
    order = [
        "same-key-register",
        "poll",
        "vendor-paste-or-verify",
        "n8n-hosts-url",
        "broker-listen",
        "unknown",
    ]
    for family in order:
        kids = families.get(family)
        if kids is None:
            continue
        family_task = post_task(
            workflow_parent_id,
            f"[family] {family} ({len(kids)} connectors)",
            (
                f"Claim this family and finish every child. {family_goal(family)}\n"
                f"Connectors: {', '.join(item['id'] for item in kids)}"
            ),
        )
        family_ids[family] = int(family_task["id"])
        print("family", family, family_ids[family])
    created = 0
    for row in rows:
        parent = family_ids[row["family"]]
        title = f"[{row['family']}] {row['id']} webhook register"
        post_task(parent, title, build_description(row))
        created += 1
    print("created_connector_tasks", created)
    dest = os.path.join(os.path.dirname(__file__), "n8n-webhook-register-research.json")
    with open(dest, "w", encoding="utf-8") as handle:
        json.dump({"epicId": epic_id, "families": family_ids, "connectors": rows}, handle, indent=2)
    print("epic_id", epic_id)


if __name__ == "__main__":
    main()
