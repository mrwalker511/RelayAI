const fs = require('fs');

async function main() {
  // Read all of stdin
  const payload = fs.readFileSync(0, 'utf-8');
  
  const host = process.env.LLAMA_API_URL || 'http://localhost:8080';
  
  try {
    const res = await fetch(`${host}/completion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: payload,
        temperature: 0.0,
        n_predict: -1
      })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      process.stderr.write(`Error from llama-server: ${res.status} - ${errText}\n`);
      process.exit(1);
    }
    
    const data = await res.json();
    process.stdout.write(data.content || '');
  } catch (err) {
    process.stderr.write(`Failed to connect to llama-server: ${err.message}\n`);
    process.exit(1);
  }
}

main();
