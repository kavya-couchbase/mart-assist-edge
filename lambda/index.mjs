// "Ask" endpoint: Lambda Function URL -> Amazon Bedrock (Converse API).
// The browser sends the question plus the products it already found on-device.
// Bedrock only writes the answer; retrieval stays at the edge.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const client = new BedrockRuntimeClient({});
const MODEL_ID = process.env.MODEL_ID;
const TOKEN = process.env.DEMO_TOKEN;

const SYSTEM = `You help a grocery store associate answer a customer standing in front of them.
Use ONLY the products provided. Reply in 2 to 3 short sentences, plain text.
Always mention aisle numbers. If a product is low on stock (under 10), say so.
If a product would be wrong for the customer's need (for example it contains sugar or jaggery and the customer is diabetic), say to avoid it.
If nothing fits, say so and suggest asking the floor manager.`;

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const handler = async (event) => {
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (TOKEN && headers['x-demo-token'] !== TOKEN) return json(401, { error: 'unauthorised' });

  let body;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString() : event.body || '{}';
    body = JSON.parse(raw);
  } catch { return json(400, { error: 'invalid JSON' }); }

  const { question, products = [] } = body;
  if (!question || typeof question !== 'string' || question.length > 300) return json(400, { error: 'question required' });

  const list = products.slice(0, 8).map((p, i) =>
    `${i + 1}. ${p.name} | ${p.description} | aisle ${p.aisle} | stock ${p.stock}`).join('\n');

  try {
    const out = await client.send(new ConverseCommand({
      modelId: MODEL_ID,
      system: [{ text: SYSTEM }],
      messages: [{ role: 'user', content: [{ text: `Customer asks: ${question}\n\nProducts found on the store device:\n${list}` }] }],
      inferenceConfig: { maxTokens: 200 },
    }));
    const answer = out.output?.message?.content?.map(c => c.text).join('').trim();
    return json(200, { answer, model: MODEL_ID });
  } catch (err) {
    console.error(err);
    return json(502, { error: err.name || 'bedrock error' });
  }
};
