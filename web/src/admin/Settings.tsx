import { useEffect, useState } from 'react';
import { usePageMeta } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Field, Spinner } from '../components/ui.tsx';
import { phoneDisplay } from '../lib/format.ts';
import { useAction, useAdmin } from './shared.tsx';

const TEXT: Array<[string, string, string?]> = [
  ['business_name', 'Nome da empresa'], ['instagram_url', 'Instagram (link completo)', 'https://www.instagram.com/trajeville/'],
  ['address', 'Endereço'], ['opening_hours', 'Horário de atendimento', 'Uma linha por período'],
];
const POLICIES: Array<[string, string]> = [
  ['policy_fitting', 'Prova'], ['policy_pickup', 'Retirada'], ['policy_return', 'Devolução'], ['policy_reservation', 'Reservas'], ['policy_cancellation', 'Cancelamento'],
];

export function SettingsPage() {
  usePageMeta('Configurações — Painel Trajeville');
  const { user } = useAdmin(); const canEdit = user.role === 'ADMIN';
  const { data, loading, error, reload } = useFetch<Record<string, string>>('/api/admin/settings');
  const [f, setF] = useState<Record<string, string>>({});
  const act = useAction();
  useEffect(() => { if (data) setF(data); }, [data]);
  if (loading && !data) return <Spinner />;
  if (error) return <Alert>{error.message}</Alert>;
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const save = () => act.run(async () => { const { hero_image, logo_image, ...rest } = f; await api.put('/api/admin/settings', rest); reload(); }, 'Configurações salvas.');
  return (
    <div>
      <div className="page-head"><h1>Configurações</h1></div>
      {!canEdit && <Alert kind="info">Somente administradores podem alterar as configurações.</Alert>}
      {act.error && <Alert>{act.error}</Alert>}{act.ok && <Alert kind="ok">{act.ok}</Alert>}
      <div className="box"><h2>WhatsApp</h2>
        <Field label="Número do WhatsApp da Trajeville" hint={f.whatsapp_number ? `Será exibido como ${phoneDisplay(f.whatsapp_number)}. O botão "Falar com a Trajeville" usa este número.` : 'Ainda não configurado: o site esconde os botões de WhatsApp até você informar o número.'} htmlFor="wn">
          <input id="wn" type="tel" inputMode="tel" placeholder="(47) 99999-9999" disabled={!canEdit} value={f.whatsapp_number ?? ''} onChange={(e) => set('whatsapp_number', e.target.value)} /></Field></div>
      <div className="box"><h2>Reservas e estoque</h2>
        <label style={{ display: 'flex', gap: '.7rem', alignItems: 'flex-start' }}>
          <input type="checkbox" disabled={!canEdit} checked={f.block_pending_stock !== 'false'} onChange={(e) => set('block_pending_stock', e.target.checked ? 'true' : 'false')} style={{ width: 22, height: 22, marginTop: 2 }} />
          <span><strong>Bloquear estoque durante solicitações pendentes</strong><br /><span className="small muted">Ativado (recomendado): uma solicitação "solicitada" ou "em análise" já separa as peças, evitando prometer a mesma peça duas vezes. Desativado: só reservas confirmadas bloqueiam; ao confirmar, o sistema revalida a disponibilidade.</span></span></label></div>
      <div className="box"><h2>Dados da empresa</h2>
        {TEXT.map(([k, label, hint]) => <Field key={k} label={label} hint={hint} htmlFor={k}>{k === 'opening_hours' ? <textarea id={k} disabled={!canEdit} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /> : <input id={k} type="text" disabled={!canEdit} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} />}</Field>)}
        <p className="small muted">Logo e foto do topo do site: envie em <strong>Galeria</strong> e use "Usar no topo".</p></div>
      <div className="box"><h2>Políticas (exibidas no site)</h2>
        {POLICIES.map(([k, label]) => <Field key={k} label={label} htmlFor={k}><textarea id={k} disabled={!canEdit} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Field>)}</div>
      {canEdit && <button className="btn btn-primary" disabled={act.busy} onClick={save}>Salvar configurações</button>}
    </div>
  );
}
