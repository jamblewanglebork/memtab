import { mkdir, writeFile } from 'node:fs/promises';

// Five distinct retrieval intents per topic; six documents have relevance judgments per intent.
const topics = [
  ['Systems_C_CPP', [
    ['Valgrind Memcheck and heap ownership', 'Track allocations that are never freed. Diagnose leaks, double frees, and dangling references in native programs.', 'the tool that tells me why my native program keeps eating more RAM'],
    ['Thread synchronization with mutexes and atomics', 'Coordinate shared state safely between workers. Compare lock ordering, race detection, acquire-release semantics, and deadlock prevention.', 'making parallel workers share a counter without corrupting it'],
    ['Linkers, object files, and CMake builds', 'Resolve undefined symbols and organize compilation units. Configure build targets, static libraries, header dependencies, and linker flags.', 'why compiling several source files gives an unresolved symbol error'],
    ['Profiling native code with perf and flame graphs', 'Find expensive functions on a running Linux application. Sample CPU time, inspect hot paths, and reduce cache misses.', 'finding which part of a compiled application is slowing everything down'],
    ['Pointer arithmetic, stack frames, and buffer bounds', 'Understand addresses, object lifetimes, and array indexing. Catch out-of-bounds access and stack corruption with address sanitizers.', 'understanding why accessing an array after a function returns crashes'],
  ]],
  ['ML_Quantization', [
    ['Eight-bit neural network weight compression', 'Map floating-point weights to integer scales and zero points. Compare symmetric and asymmetric quantizers and reduce model size.', 'shrinking a learned model so it fits on a small laptop'],
    ['Calibration data for post-training quantization', 'Collect activation distributions on representative inputs. Choose clipping ranges and minimize degradation without retraining.', 'using sample inputs to decide how much numerical detail a model can lose'],
    ['Binary embeddings and packed sign vectors', 'Represent dense semantic vectors with one bit per dimension. Use Hamming distance and popcount for compact retrieval.', 'storing document meaning using only yes-or-no values'],
    ['ONNX inference on browser WebAssembly', 'Deploy an exported neural model in a web runtime. Configure execution providers, WASM threads, and tokenizer preprocessing.', 'running learned predictions inside a web page without a server'],
    ['Quantization-aware fine tuning', 'Simulate rounding during optimization so weights adapt to low precision. Compare fake quantization and straight-through gradient estimators.', 'teaching a model to stay accurate after its numbers have been rounded'],
  ]],
  ['Web_Architecture', [
    ['Manifest V3 offscreen extension documents', 'Host DOM and WebAssembly work outside an idle-terminated service worker. Route extension messages and guard offscreen creation.', 'keeping background browser work alive when the worker goes to sleep'],
    ['IndexedDB transactions and offline persistence', 'Store structured records locally with object stores and indexes. Handle upgrades, transaction lifetimes, and durable writes.', 'saving structured data on a device so it survives closing the page'],
    ['React hydration and single-page navigation', 'Reconcile server-rendered markup with client state. Observe route changes and schedule work after asynchronous content updates.', 'waiting for a website to finish showing its client-side content'],
    ['Content Security Policy and script isolation', 'Restrict executable origins and avoid dynamic evaluation. Separate extension code from untrusted website scripts.', 'preventing a page from loading executable code from random servers'],
    ['Service-worker caching and progressive web apps', 'Cache assets with a network-first or stale-while-revalidate strategy. Support offline navigation and invalidate outdated resources.', 'making an installed website usable after the internet disconnects'],
  ]],
  ['Personal_Finance', [
    ['Low-cost index funds and diversification', 'Own a broad basket of assets instead of choosing individual stocks. Compare expense ratios, passive portfolios, and rebalancing.', 'a cheap way to invest across lots of businesses at once'],
    ['Emergency savings and household budgets', 'Plan monthly spending and build a cash buffer. Separate essential expenses, discretionary purchases, and rainy-day funds.', 'setting aside money so an unexpected repair will not put me in debt'],
    ['Compound interest and retirement contributions', 'Estimate how recurring deposits grow over decades. Consider tax-advantaged accounts, contribution limits, and time horizons.', 'what regular small deposits could become by the time I stop working'],
    ['Mortgage rates and loan amortization', 'Break down payments into principal and interest. Compare fixed versus variable rates and the effect of early repayments.', 'how much of my monthly house payment actually reduces what I owe'],
    ['Bonds, duration, and asset allocation', 'Balance equities with fixed-income holdings. Understand rate sensitivity, credit quality, and risk-adjusted portfolio construction.', 'adding steadier investments to a portfolio that swings too wildly'],
  ]],
  ['Cooking_Nutrition', [
    ['Tomato pasta sauce and starch emulsions', 'Combine olive oil, simmered tomatoes, garlic, and reserved cooking water. Finish noodles in the pan for a glossy sauce.', 'an easy red-sauce dinner that sticks nicely to the noodles'],
    ['Sourdough starters and bread fermentation', 'Feed a live culture and control proofing temperature. Shape dough, develop gluten, and bake a crisp open-crumb loaf.', 'keeping the living mixture for homemade loaves active and healthy'],
    ['Plant-based protein and balanced meals', 'Combine lentils, beans, tofu, and whole grains. Meet dietary protein needs and plan nutritious vegetarian meals.', 'getting enough muscle-building nutrients without eating meat'],
    ['Meal prep, food storage, and safe reheating', 'Batch cook ingredients for busy weekdays. Chill leftovers promptly, label containers, and reheat to safe temperatures.', 'preparing several lunches ahead of time without anything spoiling'],
    ['Roasting vegetables and caramelization', 'Use high oven heat, adequate spacing, and a little oil. Develop browned edges on carrots, potatoes, and brassicas.', 'making oven-cooked greens taste crisp and sweet instead of soggy'],
  ]],
  ['Motorsport_Engineering', [
    ['Ground-effect aerodynamics and downforce', 'Accelerate airflow beneath the floor to increase cornering grip. Balance aerodynamic load against drag and ride-height sensitivity.', 'why racing cars can take bends faster when air flows under them'],
    ['Tire degradation and thermal operating windows', 'Manage rubber temperature, pressure, and wear. Diagnose graining and blistering and extend consistent lap performance.', 'why the rubber stops gripping after several fast laps'],
    ['Suspension geometry and mechanical grip', 'Tune camber, toe, springs, and anti-roll bars. Balance load transfer and preserve contact patch quality over bumps.', 'adjusting the chassis so the wheels stay planted on uneven corners'],
    ['Hybrid power units and energy recovery', 'Harvest braking energy and deploy electrical assistance on straights. Coordinate combustion, battery charge, and motor output.', 'reusing energy from slowing down to accelerate a race car later'],
    ['Race strategy and pit-stop undercuts', 'Compare stint lengths, fresh-tire advantage, traffic, and safety-car timing. Calculate when stopping earlier gains track position.', 'deciding whether an earlier tire change can get a driver ahead'],
  ]],
  ['Cloud_DevOps', [
    ['Kubernetes deployments and rolling updates', 'Schedule containers, manage replicas, and update services without downtime. Configure readiness probes and rollback failed releases.', 'shipping a new service version while people keep using the old one'],
    ['Terraform infrastructure and state management', 'Define cloud resources as declarative configuration. Review plans, lock remote state, and prevent infrastructure drift.', 'creating the same hosted environment reliably from a configuration file'],
    ['CI pipelines and automated release checks', 'Build and test every change before publishing artifacts. Cache dependencies and require passing checks before deployment.', 'automatically checking each code change before it reaches production'],
    ['Observability with logs, metrics, and tracing', 'Follow requests across distributed services. Track latency percentiles, correlate errors, and alert on user-visible failures.', 'following one failing request through several hosted services'],
    ['Cloud cost controls and autoscaling', 'Match resource capacity to demand. Set spending budgets, remove idle instances, and tune horizontal scaling policies.', 'reducing the hosting bill when nobody is using the service'],
  ]],
  ['Linear_Algebra', [
    ['Eigenvalues and eigenvectors of linear maps', 'Identify directions preserved by a matrix transformation. Interpret spectral decomposition, stability, and repeated multiplication.', 'directions that stay pointing the same way after a transformation'],
    ['Singular value decomposition and low-rank approximation', 'Factor a rectangular matrix into orthogonal bases and strengths. Compress data by keeping the dominant components.', 'approximating a large table of numbers with fewer independent patterns'],
    ['Dot products, cosine angles, and vector projections', 'Measure alignment between directions and decompose one vector along another. Relate inner products to geometric similarity.', 'measuring whether two arrows point in nearly the same direction'],
    ['Gaussian elimination and solving linear systems', 'Use row operations to find unknowns in simultaneous equations. Detect inconsistent or underdetermined systems.', 'finding several unknown quantities from equations that constrain them together'],
    ['Orthogonal bases and Gram-Schmidt construction', 'Convert independent directions into perpendicular unit vectors. Span a subspace and build a numerically useful coordinate system.', 'turning a collection of directions into perpendicular reference axes'],
  ]],
];
const variants = [
  ['A practical introduction', 'This introductory explanation connects the central mechanism to an everyday example and walks through the first steps.'],
  ['Worked examples and common mistakes', 'Several worked scenarios illustrate the method, followed by pitfalls, edge cases, and ways to verify the outcome.'],
  ['A troubleshooting field guide', 'A diagnostic checklist distinguishes common symptoms and explains how to isolate the cause before changing the setup.'],
  ['Design tradeoffs explained', 'Compare alternative approaches, resource costs, and accuracy limits. Choose a method based on the constraints of the task.'],
  ['Hands-on workshop notes', 'An end-to-end exercise gives concrete settings and intermediate observations, with guidance for adapting it to another project.'],
  ['Reference notes for practitioners', 'Compact reference material explains terminology, performance considerations, and the reasoning behind standard recommendations.'],
];
const documents = [], queries = [];
for (const [topic, aspects] of topics) for (let aspect = 0; aspect < aspects.length; aspect++) {
  const [title, detail, query] = aspects[aspect];
  const relevantIds = [];
  variants.forEach(([variant, extra], index) => {
    const id = `${topic}-${aspect}-${index}`; relevantIds.push(id);
    documents.push({ id, topic, title: `${title}: ${variant.toLowerCase()}`, snippet: `${detail} ${extra}` });
  });
  queries.push({ id: `${topic}-q${aspect}`, topic, text: query, relevantIds });
}
await mkdir('src/benchmark', { recursive: true });
await writeFile('src/benchmark/synthetic_dataset.json', JSON.stringify({ version: 1, description: 'Synthetic exploratory trace: 8 topics, 5 retrieval intents each, 6 document variants per intent. Explicit relevance judgments; not a validated real-world retrieval benchmark.', documents, queries }, null, 2) + '\n');
console.log(`Created ${documents.length} documents and ${queries.length} judged queries.`);
