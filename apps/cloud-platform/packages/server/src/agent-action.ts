export type AgentTaskDraft = {
  title: string;
  description: string;
};

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 20_000;

function stripHeading(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^(title|başlık|baslik)\s*[:：]\s*/i, "")
    .trim();
}

/**
 * Agents reply with prose, so the first meaningful line becomes the task title
 * and the whole reply becomes the description.
 */
export function agentTaskFromOutput(input: {
  output: string;
  fallbackTitle: string;
  eventType: string;
  eventPath: string;
  eventDetail: string;
}): AgentTaskDraft {
  const body = input.output.trim();
  let title = "";
  for (const raw of body.split("\n")) {
    const line = stripHeading(raw);
    if (line.length === 0) {
      continue;
    }
    title = line;
    break;
  }
  if (title.length === 0) {
    title = input.fallbackTitle.trim();
  }
  if (title.length === 0) {
    title = input.eventType;
  }
  if (title.length > TITLE_MAX) {
    title = `${title.slice(0, TITLE_MAX - 1)}…`;
  }
  const context: string[] = [];
  if (body.length > 0) {
    context.push(body);
  }
  const trail: string[] = [`Triggered by ${input.eventType}`];
  if (input.eventPath.trim().length > 0) {
    trail.push(input.eventPath.trim());
  }
  if (input.eventDetail.trim().length > 0) {
    trail.push(input.eventDetail.trim());
  }
  context.push(`---\n${trail.join("\n")}`);
  let description = context.join("\n\n");
  if (description.length > DESCRIPTION_MAX) {
    description = description.slice(0, DESCRIPTION_MAX);
  }
  return { title, description };
}
