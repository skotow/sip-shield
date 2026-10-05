import socket
import struct
import unittest
from trace_capture import decode, sanitize

class TraceTests(unittest.TestCase):
    def test_redaction_precedes_persistence(self):
        payload=b'REGISTER sip:alice:uri-secret@example.test SIP/2.0\r\nCall-ID: test\r\nCSeq: 2 REGISTER\r\nAuthorization: Digest secret\r\n continuation-secret\r\nProxy-Authorization: proxy-secret\r\nX-Custom-Token: custom-secret\r\nVia: SIP/2.0/UDP example.test\r\n\r\nbody-secret'
        record=sanitize(payload)
        self.assertEqual(record['call_id'],'test')
        self.assertEqual(record['method'],'REGISTER')
        self.assertNotIn('secret',record['message'])
        self.assertIn('Authorization: [redacted]',record['message'])
        self.assertIn('Via: SIP/2.0/UDP example.test',record['message'])
        self.assertIn('Body omitted',record['message'])

    def test_hep_metadata_and_invalid_frames(self):
        fields={2:b'\x11',3:socket.inet_aton('192.0.2.1'),4:socket.inet_aton('10.0.0.2'),7:struct.pack('!H',51000),8:struct.pack('!H',5060),9:struct.pack('!I',1700000000),10:struct.pack('!I',123456),15:b'SIP/2.0 401 Unauthorized\r\nCall-ID: test\r\nCSeq: 1 REGISTER\r\n\r\n'}
        chunks=b''.join(struct.pack('!HHH',0,key,len(value)+6)+value for key,value in fields.items())
        packet=b'HEP3'+struct.pack('!H',len(chunks)+6)+chunks
        record=decode(packet,{'10.0.0.2'})
        self.assertEqual(record['response_code'],401)
        self.assertEqual(record['source_ip'],'192.0.2.1')
        self.assertEqual(record['destination_role'],'gateway')
        self.assertEqual(record['source_port'],51000)
        self.assertAlmostEqual(record['timestamp'],1700000000.123456)
        for malformed in [b'',packet[:-1],b'HEP3\x00\x0c'+b'\x00'*6]:
            with self.assertRaises(ValueError): decode(malformed,set())

    def test_compact_id_and_display_limit(self):
        record=sanitize(b'OPTIONS sip:test SIP/2.0\r\ni: compact\r\nCSeq: 1 OPTIONS\r\nVia: '+b'x'*20000+b'\r\n\r\n')
        self.assertEqual(record['call_id'],'compact')
        self.assertTrue(record['truncated'])
        self.assertLessEqual(len(record['message']),16384)

    def test_untrusted_control_bytes_cannot_poison_database_text(self):
        record=sanitize(b'OPTIONS sip:test SIP/2.0\r\nCall-ID: malformed\x00id\r\nVia: bad\x00header\r\n\r\n')
        self.assertNotIn('\x00',record['message'])
        self.assertNotIn('\x00',record['call_id'])

if __name__=='__main__': unittest.main()
