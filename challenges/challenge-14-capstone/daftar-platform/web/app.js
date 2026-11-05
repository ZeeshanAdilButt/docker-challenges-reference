// The Daftar page: send a job, then show the list of jobs every two seconds.
const $ = (id) => document.getElementById(id);

async function refresh() {
  try {
    const [jobs, root] = await Promise.all([fetch('/api/jobs').then((r) => r.json()), fetch('/api/').then((r) => r.json())]);
    $('version').textContent = root.version;
    $('jobs').replaceChildren(
      ...jobs.jobs.map((j) => {
        const tr = document.createElement('tr');
        for (const v of [j.id, j.text, j.status, j.result ?? '']) {
          const td = document.createElement('td');
          td.textContent = v;
          tr.append(td);
        }
        return tr;
      }),
    );
    $('status').textContent = '';
  } catch {
    $('status').textContent = 'The API does not answer.';
  }
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await fetch('/api/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: $('text').value }) });
  $('status').textContent = r.ok ? 'Queued.' : 'The API said no.';
  $('text').value = '';
  refresh();
});

refresh();
setInterval(refresh, 2000);
