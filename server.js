const express = require('express');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(express.static('public'));
app.use(express.json());

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const MEMORIA_FILE = 'memoria.json';
const RESULTADOS_FILE = 'resultados.json';

// ─── MEMORIA Y RESULTADOS ─────────────────────────────────────────────────────
function leerJSON(file, defecto) {
  try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch(e) {}
  return defecto;
}
function guardarJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// ─── PROMPTS DE AGENTES ───────────────────────────────────────────────────────
const AGENTES = {
  ventas: {
    nombre: 'Ventas',
    emoji: '💰',
    prompt: `Eres el agente de VENTAS. Obsesionado con dinero y conversión.
Critica todo lo que no genere ingresos directos o leads.
Sé brutal y directo. Máximo 3 oraciones.
Formato: {"critica":"...","impacto_ventas":"alto/medio/bajo","sugerencia":"..."}`
  },
  marketing: {
    nombre: 'Marketing',
    emoji: '📢',
    prompt: `Eres el agente de MARKETING. Propones visibilidad y volumen.
Evalúa alcance, viralidad y posicionamiento.
Sé directo. Máximo 3 oraciones.
Formato: {"critica":"...","impacto_marketing":"alto/medio/bajo","sugerencia":"..."}`
  },
  finanzas: {
    nombre: 'Finanzas',
    emoji: '📊',
    prompt: `Eres el agente de FINANZAS. Cortas gastos inútiles y mides ROI real.
No apruebas nada sin validación de impacto económico.
Sé directo. Máximo 3 oraciones.
Formato: {"critica":"...","roi_estimado":"alto/medio/bajo/negativo","sugerencia":"..."}`
  },
  producto: {
    nombre: 'Producto',
    emoji: '🛠️',
    prompt: `Eres el agente de PRODUCTO. Evalúas viabilidad técnica y complejidad.
Detectas si algo es construible rápido o es una trampa de tiempo.
Sé directo. Máximo 3 oraciones.
Formato: {"critica":"...","viabilidad":"alta/media/baja","sugerencia":"..."}`
  },
  investigador: {
    nombre: 'Investigador IA',
    emoji: '🧠',
    prompt: `Eres el agente INVESTIGADOR de IA. Traes oportunidades nuevas e innovación.
Propones qué tendencias de IA pueden aplicarse al negocio ahora.
Sé directo. Máximo 3 oraciones.
Formato: {"critica":"...","oportunidad":"...","sugerencia":"..."}`
  }
};

const CEREBRO_PROMPT = `Eres "CEREBRO", director estratégico de Daniel González.
Recibes el debate completo de 5 agentes especializados y decides.

CRITERIOS DE DECISIÓN:
1. Impacto en ingresos (prioridad máxima)
2. Velocidad de implementación
3. Facilidad de ejecución

REGLAS:
- Máximo 3 acciones concretas
- Si algo no genera dinero en 30 días, descártalo
- Sé brutal con las ideas débiles
- Decide, no sugieras

FORMATO OBLIGATORIO (JSON):
{
  "decision": "aprobado/rechazado/modificado",
  "razon": "1-2 líneas",
  "prioridades": ["acción 1", "acción 2", "acción 3"],
  "descartado": ["qué se descarta y por qué"],
  "plazo": "X días",
  "mensaje_final": "directo a Daniel"
}`;

const APRENDIZAJE_PROMPT = `Eres el motor de aprendizaje del sistema CEREBRO.
Analiza los resultados registrados y genera insights accionables.

ANALIZA:
1. Qué acciones generaron resultados
2. Qué falló y por qué
3. Patrones detectados

FORMATO (JSON):
{
  "patrones": ["patrón 1", "patrón 2"],
  "aciertos": ["qué funcionó"],
  "fallos": ["qué no funcionó"],
  "insights": ["insight accionable 1", "insight accionable 2"],
  "ajuste_recomendado": "ajuste de comportamiento/ejecución (NO de reglas base)",
  "requiere_aprobacion": false
}`;

// ─── LLAMADA A ANTHROPIC ──────────────────────────────────────────────────────
async function llamarIA(system, userContent, maxTokens = 800) {
  const response = await axios.post('https://api.anthropic.com/v1/messages', {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: typeof userContent === 'string' ? userContent : JSON.stringify(userContent) }]
  }, {
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    timeout: 30000
  });
  const text = response.data.content[0].text;
  try { return JSON.parse(text.replace(/```json|```/g, '').trim()); }
  catch(e) { return { raw: text }; }
}

// ─── MESA DE DECISIÓN ─────────────────────────────────────────────────────────
async function ejecutarDebate(propuesta, contexto) {
  const debate = { propuesta, criticas: {}, propuesta_mejorada: null };

  // Ronda 1: cada agente critica
  const criticas = await Promise.all(
    Object.entries(AGENTES).map(async ([id, agente]) => {
      try {
        const critica = await llamarIA(
          agente.prompt,
          `Propuesta: ${propuesta}\nContexto: ${contexto || 'Empresa de agentes IA'}`
        );
        return [id, { ...critica, agente: agente.nombre, emoji: agente.emoji }];
      } catch(e) {
        return [id, { error: e.message, agente: agente.nombre, emoji: agente.emoji }];
      }
    })
  );
  criticas.forEach(([id, critica]) => { debate.criticas[id] = critica; });

  // Ronda 2: propuesta mejorada basada en críticas
  try {
    const mejora = await llamarIA(
      `Eres un sintetizador. Toma la propuesta original y las críticas de los agentes.
Genera una propuesta mejorada que incorpore las mejores sugerencias.
Formato JSON: {"propuesta_mejorada":"...","cambios_principales":["cambio 1","cambio 2"]}`,
      { propuesta_original: propuesta, criticas: debate.criticas }
    );
    debate.propuesta_mejorada = mejora;
  } catch(e) {
    debate.propuesta_mejorada = { propuesta_mejorada: propuesta, cambios_principales: [] };
  }

  return debate;
}

// ─── ENDPOINTS ────────────────────────────────────────────────────────────────

// POST /api/activar — flujo completo: debate → cerebro → guardar
app.post('/api/activar', async (req, res) => {
  const { propuesta, contexto, modulos, tareas, notas } = req.body;
  if (!propuesta) return res.json({ success: false, error: 'propuesta requerida' });

  const memoria = leerJSON(MEMORIA_FILE, { historial: [], patrones: [], insights: [] });

  try {
    // Paso 1: debate entre agentes
    const debate = await ejecutarDebate(propuesta, contexto);

    // Paso 2: cerebro decide
    const decision = await llamarIA(CEREBRO_PROMPT, {
      propuesta_original: propuesta,
      debate,
      historial_reciente: memoria.historial.slice(-5),
      estado_empresa: { modulos, tareas, notas }
    }, 1000);

    // Paso 3: guardar en memoria
    const entrada = {
      fecha: new Date().toISOString(),
      propuesta,
      debate,
      decision,
      resultado_registrado: false
    };
    memoria.historial.unshift(entrada);
    if (memoria.historial.length > 50) memoria.historial = memoria.historial.slice(0, 50);
    guardarJSON(MEMORIA_FILE, memoria);

    res.json({ success: true, debate, decision, fecha: new Date().toISOString() });

  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// POST /api/resultado — registrar resultado de una acción
app.post('/api/resultado', (req, res) => {
  const { accion, resultado, leads, ingresos, notas } = req.body;
  const resultados = leerJSON(RESULTADOS_FILE, { registros: [] });
  resultados.registros.unshift({
    fecha: new Date().toISOString(),
    accion,
    resultado,
    leads: leads || 0,
    ingresos: ingresos || 0,
    notas: notas || ''
  });
  if (resultados.registros.length > 100) resultados.registros = resultados.registros.slice(0, 100);
  guardarJSON(RESULTADOS_FILE, resultados);
  res.json({ success: true });
});

// POST /api/aprender — motor de aprendizaje
app.post('/api/aprender', async (req, res) => {
  const resultados = leerJSON(RESULTADOS_FILE, { registros: [] });
  const memoria = leerJSON(MEMORIA_FILE, { historial: [], patrones: [], insights: [] });

  if (resultados.registros.length < 2) {
    return res.json({ success: false, error: 'Necesitas al menos 2 resultados registrados para aprender' });
  }

  try {
    const insights = await llamarIA(APRENDIZAJE_PROMPT, {
      resultados: resultados.registros.slice(0, 20),
      historial_decisiones: memoria.historial.slice(0, 10)
    }, 1000);

    memoria.insights = insights.insights || [];
    memoria.patrones = insights.patrones || [];
    guardarJSON(MEMORIA_FILE, memoria);

    res.json({ success: true, insights });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// GET /api/historial
app.get('/api/historial', (req, res) => {
  const memoria = leerJSON(MEMORIA_FILE, { historial: [] });
  res.json({ success: true, historial: memoria.historial.slice(0, 10) });
});

// GET /api/resultados
app.get('/api/resultados', (req, res) => {
  const data = leerJSON(RESULTADOS_FILE, { registros: [] });
  res.json({ success: true, registros: data.registros.slice(0, 20) });
});

app.get('/', (req, res) => { res.sendFile(__dirname + '/public/index.html'); });

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => console.log(`🧠 Cerebro v2 corriendo en http://localhost:${PORT}`));