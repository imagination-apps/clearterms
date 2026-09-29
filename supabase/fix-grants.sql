-- ClearTerms: サーバー(service_role)にテーブルの読み書きを許可する(1回だけ実行)
grant usage on schema public to service_role;
grant select, insert, update, delete on
  public.clearterms_licenses, public.clearterms_credit_packs, public.clearterms_free_usage,
  public.clearterms_email_codes, public.clearterms_code_sends
  to service_role;
grant usage, select on sequence public.clearterms_code_sends_id_seq to service_role;
