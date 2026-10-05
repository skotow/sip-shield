"""Connection/port rendering tests without a live database or SIP process."""
import os, pathlib, tempfile, unittest
from unittest.mock import patch
import runtime

class RenderTests(unittest.TestCase):
    def render(self, environment):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            (root/'kamailio.cfg').write_text('@DB_URL@ listen=udp:0.0.0.0:5060 advertise @ADVERTISED_HOST@:5060')
            with patch.object(runtime,'ROOT',root),patch.dict(os.environ,environment,clear=True):
                runtime.render(root/'rendered.cfg')
            return (root/'rendered.cfg').read_text()
    def test_derived_connection_and_custom_advertised_port(self):
        text=self.render(dict(PGUSER='custom',PGDATABASE='custom_db',PGPASSWORD='a@b/c',SIP_LISTEN_PORT='15060'))
        self.assertIn('postgres://custom:a%40b%2Fc@postgres:5432/custom_db',text)
        self.assertIn('127.0.0.1:15060',text)
    def test_explicit_connection_uri(self):
        self.assertIn('postgres://custom:secret@postgres/db',self.render(dict(DATABASE_URL='postgresql://custom:secret@postgres/db')))
    def test_invalid_config_values_rejected(self):
        for environment in [dict(PGPASSWORD='secret',SIP_LISTEN_PORT='99999'),dict(DATABASE_URL='postgresql://x:"bad"@postgres/db'),dict(DATABASE_URL='sqlite:///tmp/file')]:
            with self.assertRaises(ValueError): self.render(environment)

if __name__=='__main__': unittest.main()
