/* NewHal user follows and private messages. */
const MESSAGE_MAX = 2000;
const MESSAGE_TRIES = 30;
const WINDOW_MS = 60 * 1000;

module.exports = function registerSocial(app, { supabase, requireAuth, jwt, JWT_SECRET, sendBrowserPush }) {
  const sends = new Map();
  const requireUser = (req, res, next) => requireAuth(req, res, () => {
    if (req.user.role !== 'user' || !userId(req.user.id)) return res.status(403).json({ error: 'Kullanıcı girişi gerekli' });
    next();
  });
  const userId = value => {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };
  const tableError = res => res.status(503).json({ error: 'Takip ve mesaj özellikleri hazırlanıyor' });
  const notify = async (recipientId, actorId, type, entityId = null, actorName = 'NewHal üyesi') => {
    if (Number(recipientId) === Number(actorId)) return;
    const { error } = await supabase.from('user_notifications').insert({
      recipient_id: recipientId, actor_id: actorId, type, entity_id: entityId,
    });
    if (error) console.error('Bildirim kaydedilemedi:', error.message);
    else if (sendBrowserPush) {
      const message = type === 'message';
      void sendBrowserPush(recipientId, {
        title: message ? 'NewHal: Yeni mesaj' : 'NewHal: Yeni takipçi',
        body: message ? `${actorName} sana mesaj gönderdi.` : `${actorName} seni takip etmeye başladı.`,
        url: message ? '/?openMessages=1' : '/?openNotifications=1',
        tag: `newhal-${type}-${entityId || actorId}`,
      });
    }
  };

  app.post('/api/users/:id/follow', requireUser, async (req, res) => {
    const target = userId(req.params.id);
    const me = userId(req.user.id);
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (target === me) return res.status(400).json({ error: 'Kendinizi takip edemezsiniz' });
    const { data: person, error: personError } = await supabase.from('users').select('id').eq('id', target).maybeSingle();
    if (personError) return res.status(500).json({ error: 'Takip işlemi yapılamadı' });
    if (!person) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const { error } = await supabase.from('user_follows').insert({ follower_id: me, following_id: target });
    if (error && error.code !== '23505') return tableError(res);
    if (!error) await notify(target, me, 'follow', null, req.user.name || 'Bir NewHal üyesi');
    res.json({ following: true });
  });

  app.delete('/api/users/:id/follow', requireUser, async (req, res) => {
    const target = userId(req.params.id);
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const { error } = await supabase.from('user_follows').delete()
      .eq('follower_id', req.user.id).eq('following_id', target);
    if (error) return tableError(res);
    res.json({ following: false });
  });

  app.get('/api/members', requireUser, async (req, res) => {
    const query = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (query.length < 2) return res.status(400).json({ error: 'Aramak için en az 2 harf yazın' });
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const { data, error } = await supabase.from('users').select('id,name,avatar')
      .ilike('name', pattern).order('name', { ascending: true }).limit(20);
    if (error) return res.status(500).json({ error: 'Üyeler aranamadı' });
    res.json(data || []);
  });

  app.get('/api/users/:id/social', async (req, res) => {
    const target = userId(req.params.id);
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const [followers, following] = await Promise.all([
      supabase.from('user_follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', target),
      supabase.from('user_follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', target),
    ]);
    if (followers.error || following.error) return tableError(res);
    let isFollowing = false;
    try {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const viewer = token ? jwt.verify(token, JWT_SECRET) : null;
      if (viewer && viewer.role === 'user' && Number(viewer.id) !== target) {
        const relation = await supabase.from('user_follows').select('follower_id')
          .eq('follower_id', viewer.id).eq('following_id', target).maybeSingle();
        isFollowing = !!relation.data;
      }
    } catch {}
    res.json({ followers: followers.count || 0, following: following.count || 0, is_following: isFollowing });
  });

  app.get('/api/users/:id/:list(followers|following)', async (req, res) => {
    const target = userId(req.params.id);
    if (!target) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const followers = req.params.list === 'followers';
    const { data: edges, error } = await supabase.from('user_follows')
      .select(followers ? 'follower_id,created_at' : 'following_id,created_at')
      .eq(followers ? 'following_id' : 'follower_id', target)
      .order('created_at', { ascending: false }).limit(100);
    if (error) return tableError(res);
    const ids = (edges || []).map(edge => edge[followers ? 'follower_id' : 'following_id']);
    if (!ids.length) return res.json([]);
    const { data: users, error: usersError } = await supabase.from('users').select('id,name,avatar').in('id', ids);
    if (usersError) return res.status(500).json({ error: 'Kullanıcı listesi açılamadı' });
    const byId = new Map((users || []).map(person => [person.id, person]));
    res.json(ids.map(id => byId.get(id)).filter(Boolean));
  });

  app.get('/api/messages', requireUser, async (req, res) => {
    const me = userId(req.user.id);
    const { data: rows, error } = await supabase.from('direct_messages').select('*')
      .or(`sender_id.eq.${me},recipient_id.eq.${me}`).order('created_at', { ascending: false }).limit(1000);
    if (error) return tableError(res);
    const conversations = new Map();
    for (const message of rows || []) {
      const partnerId = Number(message.sender_id) === me ? message.recipient_id : message.sender_id;
      const conversation = conversations.get(partnerId) || { user_id: partnerId, unread: 0, last_message: message };
      if (Number(message.recipient_id) === me && !message.read_at) conversation.unread++;
      conversations.set(partnerId, conversation);
    }
    const items = [...conversations.values()].sort((a, b) => new Date(b.last_message.created_at) - new Date(a.last_message.created_at));
    const ids = items.map(item => item.user_id);
    if (!ids.length) return res.json({ conversations: [], unread: 0 });
    const { data: people, error: peopleError } = await supabase.from('users').select('id,name,avatar').in('id', ids);
    if (peopleError) return res.status(500).json({ error: 'Mesaj listesi açılamadı' });
    const byId = new Map((people || []).map(person => [person.id, person]));
    const result = items.filter(item => byId.has(item.user_id)).map(item => ({
      ...item, user: byId.get(item.user_id),
      last_message: { body: item.last_message.body, sender_id: item.last_message.sender_id, created_at: item.last_message.created_at },
    }));
    res.json({ conversations: result, unread: result.reduce((sum, item) => sum + item.unread, 0) });
  });

  app.get('/api/notifications', requireUser, async (req, res) => {
    const me = userId(req.user.id);
    const [list, unread] = await Promise.all([
      supabase.from('user_notifications').select('*').eq('recipient_id', me)
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('user_notifications').select('id', { count: 'exact', head: true })
        .eq('recipient_id', me).is('read_at', null),
    ]);
    if (list.error || unread.error) return res.status(503).json({ error: 'Bildirimler henüz hazırlanıyor' });
    const actorIds = [...new Set((list.data || []).map(item => item.actor_id).filter(Boolean))];
    const { data: actors, error: actorsError } = actorIds.length
      ? await supabase.from('users').select('id,name,avatar').in('id', actorIds)
      : { data: [], error: null };
    if (actorsError) return res.status(500).json({ error: 'Bildirimler açılamadı' });
    const byId = new Map((actors || []).map(actor => [Number(actor.id), actor]));
    res.json({
      notifications: (list.data || []).map(item => ({ ...item, actor: byId.get(Number(item.actor_id)) || { id: item.actor_id, name: 'NewHal üyesi', avatar: '' } })),
      unread: unread.count || 0,
    });
  });

  app.patch('/api/notifications/:id/read', requireUser, async (req, res) => {
    const id = userId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Bildirim bulunamadı' });
    const { error } = await supabase.from('user_notifications').update({ read_at: new Date().toISOString() })
      .eq('id', id).eq('recipient_id', req.user.id).is('read_at', null);
    if (error) return tableError(res);
    res.json({ read: true });
  });

  app.get('/api/messages/:id', requireUser, async (req, res) => {
    const partner = userId(req.params.id);
    const me = userId(req.user.id);
    if (!partner || partner === me) return res.status(400).json({ error: 'Geçersiz konuşma' });
    const [sent, received, person] = await Promise.all([
      supabase.from('direct_messages').select('*').eq('sender_id', me).eq('recipient_id', partner).order('created_at', { ascending: false }).limit(100),
      supabase.from('direct_messages').select('*').eq('sender_id', partner).eq('recipient_id', me).order('created_at', { ascending: false }).limit(100),
      supabase.from('users').select('id,name,avatar').eq('id', partner).maybeSingle(),
    ]);
    if (sent.error || received.error) return tableError(res);
    if (person.error || !person.data) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const messages = [...(sent.data || []), ...(received.data || [])]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(-100);
    const unreadIds = messages.filter(message => Number(message.recipient_id) === me && !message.read_at).map(message => message.id);
    if (unreadIds.length) {
      const readAt = new Date().toISOString();
      await supabase.from('direct_messages').update({ read_at: readAt }).in('id', unreadIds).eq('recipient_id', me);
      messages.forEach(message => { if (unreadIds.some(id => Number(id) === Number(message.id))) message.read_at = readAt; });
    }
    res.json({ user: person.data, messages });
  });

  app.post('/api/messages/:id', requireUser, async (req, res) => {
    const recipient = userId(req.params.id);
    const sender = userId(req.user.id);
    const body = String(req.body.body || '').trim();
    if (!recipient || recipient === sender) return res.status(400).json({ error: 'Geçersiz alıcı' });
    if (!body || body.length > MESSAGE_MAX) return res.status(400).json({ error: `Mesaj 1 ile ${MESSAGE_MAX} karakter arasında olmalı` });
    const now = Date.now();
    const times = (sends.get(sender) || []).filter(time => time > now - WINDOW_MS);
    if (times.length >= MESSAGE_TRIES) return res.status(429).json({ error: 'Çok sık mesaj gönderiyorsunuz. Biraz sonra tekrar deneyin.' });
    const { data: person, error: personError } = await supabase.from('users').select('id').eq('id', recipient).maybeSingle();
    if (personError) return res.status(500).json({ error: 'Mesaj gönderilemedi' });
    if (!person) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const { data: message, error } = await supabase.from('direct_messages')
      .insert({ sender_id: sender, recipient_id: recipient, body }).select().single();
    if (error) return tableError(res);
    await notify(recipient, sender, 'message', message.id, req.user.name || 'Bir NewHal üyesi');
    times.push(now);
    sends.set(sender, times);
    res.status(201).json(message);
  });
};
