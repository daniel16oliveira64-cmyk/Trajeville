import { useState } from 'react';
import { usePageMeta } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Field, Modal, Spinner } from '../components/ui.tsx';
import { useAction } from './shared.tsx';

export function FaqPage() {
  usePageMeta('FAQ — Painel Trajeville');
  const { data, loading, error, reload } = useFetch<any[]>('/api/admin/faqs');
  const [edit, setEdit] = useState<any | null>(null);
  const act = useAction();
  const save = () => act.run(async () => { edit.id ? await api.put(`/api/admin/faqs/${edit.id}`, edit) : await api.post('/api/admin/faqs', edit); setEdit(null); reload(); }, 'Pergunta salva.');
  return (
    <div>
      <div className="page-head"><h1>Perguntas frequentes</h1><button className="btn btn-primary btn-sm" onClick={() => setEdit({ question: '', answer: '', position: (data?.length ?? 0) + 1, published: true })}>Nova pergunta</button></div>
      <p className="muted small">As respostas abaixo aparecem no site. Ajuste cada uma conforme as regras reais da Trajeville.</p>
      {act.ok && <Alert kind="ok">{act.ok}</Alert>}
      {loading && !data ? <Spinner /> : error ? <Alert>{error.message}</Alert> : (
        <div className="table-wrap"><table><thead><tr><th className="num">#</th><th>Pergunta</th><th>Site</th><th></th></tr></thead><tbody>
          {data!.map((f) => (<tr key={f.id}><td className="num">{f.position}</td><td><strong>{f.question}</strong><div className="small muted">{f.answer.slice(0, 120)}{f.answer.length > 120 ? '…' : ''}</div></td>
            <td><span className={`badge ${f.published ? 'ok' : 'muted'}`}>{f.published ? 'Publicada' : 'Oculta'}</span></td>
            <td className="actions"><button className="btn btn-ghost btn-sm" onClick={() => setEdit(f)}>Editar</button><button className="btn btn-danger btn-sm" onClick={() => confirm('Excluir esta pergunta?') && act.run(async () => { await api.del(`/api/admin/faqs/${f.id}`); reload(); })}>Excluir</button></td></tr>))}</tbody></table></div>)}
      {edit && (<Modal title={edit.id ? 'Editar pergunta' : 'Nova pergunta'} onClose={() => setEdit(null)}>
        {act.error && <Alert>{act.error}</Alert>}
        <Field label="Pergunta" htmlFor="fq"><input id="fq" type="text" value={edit.question} onChange={(e) => setEdit({ ...edit, question: e.target.value })} /></Field>
        <Field label="Resposta" htmlFor="fa"><textarea id="fa" style={{ minHeight: 160 }} value={edit.answer} onChange={(e) => setEdit({ ...edit, answer: e.target.value })} /></Field>
        <div className="row two"><Field label="Posição" htmlFor="fp"><input id="fp" type="number" min={0} value={edit.position} onChange={(e) => setEdit({ ...edit, position: Number(e.target.value) })} /></Field>
          <label style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '1.6rem' }}><input type="checkbox" checked={edit.published} onChange={(e) => setEdit({ ...edit, published: e.target.checked })} style={{ width: 20, height: 20 }} /> Publicada no site</label></div>
        <button className="btn btn-primary" disabled={act.busy} onClick={save}>Salvar</button></Modal>)}
    </div>
  );
}
