import axios from "axios";

/** Read raw body for x-www-form-urlencoded (Twilio) */
async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Parse x-www-form-urlencoded -> object */
function parseFormUrlEncoded(str) {
  const params = new URLSearchParams(str);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const raw = await readRawBody(req);
  const form = parseFormUrlEncoded(raw);

  const fromRaw = form.From || "";
  const from = fromRaw.replace("whatsapp:", ""); // expect +34...

  const text = (form.Body || "").trim();

  console.log("📩 Twilio payload keys:", Object.keys(form));
  console.log("📩 From raw:", fromRaw, "Parsed number:", from);
  console.log("📩 Message text length:", text.length);

  if (!from || !from.startsWith("+")) {
    console.error("❗ No valid E.164 number parsed from Twilio 'From'. Full form:", form);
  }

  // Preferred identifier: WHATSAPP (Brevo accepts WHATSAPP as identifier)
  let payload = {
    WHATSAPP: from,
    attributes: {
      SOURCE: "WhatsApp",
      FIRST_MSG: text,
      WHATSAPP_OPTIN: true
    },
    updateEnabled: true
  };

  const listId = process.env.BREVO_LIST_ID;
  if (listId) payload.listIds = [Number(listId)];

  // Try WHATSAPP first; if Brevo says missing_parameter, retry with SMS (uppercase)
  const brevoHeaders = {
    "api-key": process.env.BREVO_API_KEY || "",
    "Content-Type": "application/json"
  };

  try {
    let r = await axios.post("https://api.brevo.com/v3/contacts", payload, {
      headers: brevoHeaders,
      timeout: 10000,
      validateStatus: () => true
    });

    if (r.status >= 300) {
      console.error("❌ Brevo (WHATSAPP) STATUS:", r.status);
      console.error("❌ Brevo (WHATSAPP) BODY:", r.data);

      // Retry with SMS identifier (uppercase)
      payload = { ...payload };
      delete payload.WHATSAPP;
      payload.SMS = from;

      const r2 = await axios.post("https://api.brevo.com/v3/contacts", payload, {
        headers: brevoHeaders,
        timeout: 10000,
        validateStatus: () => true
      });

      if (r2.status >= 300) {
        console.error("❌ Brevo (SMS) STATUS:", r2.status);
        console.error("❌ Brevo (SMS) BODY:", r2.data);
      } else {
        console.log("✅ Brevo OK with SMS:", r2.status, r2.data);
      }
    } else {
      console.log("✅ Brevo OK with WHATSAPP:", r.status, r.data);
    }
  } catch (e) {
    console.error("❌ Brevo NETWORK error:", e.message);
  }

  res.status(200).send("OK");
}
