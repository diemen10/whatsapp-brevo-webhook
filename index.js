import axios from "axios";

/** Lee el raw body del request (necesario porque Twilio manda x-www-form-urlencoded) */
async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/** Convierte x-www-form-urlencoded → objeto JS */
function parseFormUrlEncoded(str) {
  const params = new URLSearchParams(str);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

export default async function handler(req, res) {
  // Solo aceptar POST (Twilio enviará POST)
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  // 1️⃣ Leer el cuerpo del mensaje
  const raw = await readRawBody(req);
  const body = parseFormUrlEncoded(raw);

  // 2️⃣ Extraer info relevante
  const from = (body.From || "").replace("whatsapp:", ""); // +34123456789
  const text = (body.Body || "").trim();

  console.log("📩 Nuevo mensaje entrante desde WhatsApp:", from, "→", text);

  // 3️⃣ Crear payload para Brevo
  const payload = {
    SMS: from,
    attributes: {
      SOURCE: "WhatsApp",
      FIRST_MSG: text,
      WHATSAPP_OPTIN: true,
    },
    updateEnabled: true,
  };

  const listId = process.env.BREVO_LIST_ID;
  if (listId) payload.listIds = [Number(listId)];

  // 4️⃣ Enviar a Brevo
  try {
    await axios.post("https://api.brevo.com/v3/contacts", payload, {
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });
    console.log("✅ Contacto creado/actualizado en Brevo:", from);
  } catch (e) {
    console.error("❌ Error enviando a Brevo:", e?.response?.data || e.message);
  }

  // 5️⃣ Responder a Twilio
  res.status(200).send("OK");
}
