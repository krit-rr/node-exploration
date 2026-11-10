-- Intros worth making: the nearest neighbours of many contacts in one query,
-- so the intros route makes one round trip instead of one per seed. Same
-- shape as similar_contacts, plus the seed each row belongs to. The route
-- falls back to similar_contacts when this function is not there yet.
create or replace function public.similar_contacts_batch(
  p_owner text,
  p_contacts text[],
  p_count int default 5
)
returns table (seed_email text, contact_email text, similarity float)
language sql stable
as $$
  select s.contact_email as seed_email,
         o.contact_email,
         1 - (o.embedding <=> s.embedding) as similarity
  from public.contact_embeddings s
  join lateral (
    select ce.contact_email, ce.embedding
    from public.contact_embeddings ce
    where ce.owner_email = p_owner
      and ce.contact_email <> s.contact_email
    order by ce.embedding <=> s.embedding
    limit p_count
  ) o on true
  where s.owner_email = p_owner
    and s.contact_email = any(p_contacts);
$$;
