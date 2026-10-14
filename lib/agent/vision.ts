// The vision re-read: one page image, one field, a fixed-format answer. The
// model is asked what the page says; the comparison with the OCR and the
// arithmetic check happen in code.

import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import type { OcrField } from "../claim/ocr-fields.ts";
import { visionReadSchema } from "./output.ts";
import type { VisionReader } from "./tools.ts";

const KIND_HINT: Record<OcrField["kind"], string> = {
  amount: "a dollar amount with cents, for example 1,800.00",
  date: "a date",
  policy: "a policy number in the form AA-AA-00000-00",
  id: "an identifier such as an estimate number",
  contact: "a phone number, email or address",
  text: "a short text value",
  hours: "a number of hours, for example 1.5",
};

export function anthropicVision(client: Anthropic, model: string): VisionReader {
  return async ({ image, mediaType, field, page }) => {
    const where = field.region ? ` It should be roughly ${Math.round(field.region.y * 100)}% of the way down the page.` : "";
    const response = await client.messages.parse({
      model,
      max_tokens: 2000,
      output_config: { format: zodOutputFormat(visionReadSchema) },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
            {
              type: "text",
              text: `This is page ${page} of a faxed document. Read the value of one field: "${field.label}" (${KIND_HINT[field.kind]}).${where} An OCR engine read it as "${field.raw ?? ""}" and may have mistaken a glyph. Report exactly what the page shows, character by character, as value. If the field is not on this page, cut off, or unreadable, set legible to false and value to null and say why in note. Do not guess.`,
            },
          ],
        },
      ],
    });
    return { read: response.parsed_output ?? { value: null, legible: false, note: "The vision model's answer could not be parsed." }, modelServed: response.model, usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } };
  };
}
