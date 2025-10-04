import axios from "axios";

// Read the raw request body (Twilio sends x-www-form-urlencoded)
async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Convert x-www-form-urlencoded into a plain JS object
function parseFormUrlEncoded(str) {
  const params = new URLSearchParams(str);
  const obj = {};
  for (const [key, value] of params.entries()) obj[key] = value;
  return obj;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  const body = parseFormUrlEncoded(rawBody);

  const fromRaw = body.From || "";
  const from = fromRaw.replace(/^whatsapp:/i, "").trim();
  const text = (body.Body || "").trim();

  console.log("[twilio] payload keys:", Object.keys(body || {}));
  console.log("[twilio] from raw:", fromRaw, "parsed:", from);
  console.log("[twilio] message length:", text.length);
  console.log("[config] BREVO_API_KEY present?", Boolean(process.env.BREVO_API_KEY));

  if (!from || !from.startsWith("+")) {
    console.error("[warn] phone number is missing or not in E.164 format. Twilio payload:", body);
  }

  const contactAttributes = {
    SOURCE: "WhatsApp",
    FIRST_MSG: text,
    WHATSAPP_OPTIN: true,
  };

  if (from) {
    contactAttributes.SMS = from;
  }

  const payload = {
    attributes: contactAttributes,
    updateEnabled: true,
  };

  console.log("[brevo] payload attribute keys", Object.keys(payload.attributes));

  const listIdEnv = process.env.BREVO_LIST_ID;
  if (listIdEnv) {
    const parsedListId = Number(listIdEnv);
    if (Number.isFinite(parsedListId)) {
      payload.listIds = [parsedListId];
    } else {
      console.warn("[config] BREVO_LIST_ID is not numeric:", listIdEnv);
    }
  }

  const headers = {
    "api-key": process.env.BREVO_API_KEY || "",
    "Content-Type": "application/json",
  };

  if (!headers["api-key"]) {
    console.error("[config] BREVO_API_KEY is empty. Skipping Brevo call.");
  } else if (!from) {
    console.error("[brevo] missing phone identifier. Skipping Brevo call.");
  } else if (!payload.attributes.SMS) {
    console.error("[brevo] payload is missing SMS attribute. Skipping Brevo call.");
  } else {
    try {
      const response = await axios.post(
        "https://api.brevo.com/v3/contacts",
        payload,
        {
          headers,
          timeout: 10000,
          validateStatus: () => true,
        }
      );

      console.log("[brevo] create/update status", response.status);

      if (response.status < 300) {
        console.log("[brevo] success", response.data);
      } else {
        console.error("[brevo] error", response.data);
      }
    } catch (error) {
      console.error("[brevo] network error", error.message);
    }
  }

  res.status(200).send("OK");
}
