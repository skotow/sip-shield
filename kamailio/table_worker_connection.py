import os, psycopg2
def connect():
    if os.environ.get('DATABASE_URL'):
        return psycopg2.connect(os.environ['DATABASE_URL'],connect_timeout=3)
    return psycopg2.connect(host=os.environ.get('PGHOST','postgres'),port=os.environ.get('PGPORT','5432'),dbname=os.environ.get('PGDATABASE','sipshield'),user=os.environ.get('PGUSER','sipshield'),password=os.environ['PGPASSWORD'],connect_timeout=3)
