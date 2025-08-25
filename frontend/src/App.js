import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Badge,
  Dialog,
  DialogTitle,
  DialogContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';

function groupLogsBySrcHost(logs) {
  const groups = {};
  logs.forEach(log => {
    const src = log.src_host || 'Unknown';
    if (!groups[src]) groups[src] = [];
    groups[src].push(log);
  });
  // Sort each group by most recent
  Object.values(groups).forEach(group => group.sort((a, b) => new Date(b.utc_time) - new Date(a.utc_time)));
  return groups;
}

export default function App() {
  const [logs, setLogs] = useState([]);
  const [grouped, setGrouped] = useState({});
  const [selectedSrc, setSelectedSrc] = useState(null);
  const [open, setOpen] = useState(false);
  const [geo, setGeo] = useState({}); // { ip: { country: 'US', flag: '🇺🇸' } }
  const [srcDetails, setSrcDetails] = useState(null); // detailed geo/AS info for selectedSrc
  const [srcDetailsLoading, setSrcDetailsLoading] = useState(false);

  useEffect(() => {
    axios.get('/api/logs').then(res => {
      setLogs(res.data.logs || []);
    });
  }, []);

  useEffect(() => {
    setGrouped(groupLogsBySrcHost(logs));
  }, [logs]);

  // Fetch GeoIP/country data for all source IPs from backend in one batch
  useEffect(() => {
    let cancelled = false;
    const ips = Object.keys(grouped).filter(ip => ip && ip !== 'Unknown');
    if (ips.length === 0) return;
    // Only fetch if we don't already have all
    const missing = ips.filter(ip => !geo[ip]);
    if (missing.length === 0) return;
    (async () => {
      try {
        const res = await fetch('/api/source_details/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ips: missing })
        });
        if (!res.ok) throw new Error('geo batch failed');
        const data = await res.json(); // { ip: { country: 'US', ... } }
        if (cancelled) return;
        // Compute flag for each
        const geoWithFlag = {};
        for (const [ip, row] of Object.entries(data)) {
          const cc = row && row.src_countrycode;
          let flag = '🏳️';
          if (cc && cc.length === 2 && /^[A-Z]{2}$/i.test(cc)) {
            const up = cc.toUpperCase();
            flag = String.fromCodePoint(up.charCodeAt(0) + 127397) + String.fromCodePoint(up.charCodeAt(1) + 127397);
          }
          geoWithFlag[ip] = { country: cc || '??', flag };
        }
        setGeo(prev => ({ ...prev, ...geoWithFlag }));
      } catch (e) {
        // fallback: mark as unknown
        const fallback = {};
        for (const ip of missing) fallback[ip] = { country: '??', flag: '🏳️' };
        setGeo(prev => ({ ...prev, ...fallback }));
      }
    })();
    return () => { cancelled = true; };
  }, [grouped, geo]);

  const handleOpen = async src => {
    setSelectedSrc(src);
    setSrcDetails(null);
    setSrcDetailsLoading(true);
    setOpen(true);
    try {
      const res = await axios.get(`/api/source_details/${encodeURIComponent(src)}`);
      setSrcDetails(res.data || null);
    } catch (e) {
      setSrcDetails(null);
    } finally {
      setSrcDetailsLoading(false);
    }
  };
  const handleClose = () => setOpen(false);

  // Sort groups by most recent log
  const sortedSrcs = Object.keys(grouped).sort((a, b) => {
    const aTime = grouped[a][0]?.utc_time || 0;
    const bTime = grouped[b][0]?.utc_time || 0;
    return new Date(bTime) - new Date(aTime);
  });

  return (
    <Box sx={{ p: 4, background: 'linear-gradient(135deg, #232526 0%, #414345 100%)', minHeight: '100vh' }}>
      <Paper elevation={6} sx={{ maxWidth: 600, mx: 'auto', p: 3, borderRadius: 4, background: 'rgba(255,255,255,0.95)' }}>
        <Typography variant="h4" fontWeight={700} gutterBottom align="center" color="primary">
          Wall of Shame Logs
        </Typography>
        <List>
          {sortedSrcs.map(src => {
            const meta = geo[src];
            return (
              <ListItem key={src} secondaryAction={
                <IconButton edge="end" onClick={() => handleOpen(src)}>
                  <InfoIcon color="primary" />
                </IconButton>
              }>
                <ListItemText
                  primary={<>
                    <Badge badgeContent={grouped[src].length} color="secondary" sx={{ mr: 2 }} />
                    <a href={`https://bgp.he.net/ip/${src}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, textDecoration: 'none', color: '#1976d2' }}>
                      {src}
                    </a>
                    <span style={{ marginLeft: 8 }} title={meta?.country || 'Loading'}>
                      {meta ? meta.flag : '…'}
                    </span>
                  </>}
                  secondary={`Most recent: ${grouped[src][0]?.utc_time || 'N/A'}`}
                />
              </ListItem>
            );
          })}
        </List>
      </Paper>
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>Logs for {selectedSrc}</DialogTitle>
        <DialogContent>
          {/* Source details section */}
          {srcDetailsLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Loading source details…</Typography>
          ) : srcDetails ? (
            <Box sx={{ mb: 2, p: 2, background: '#f5f5f5', borderRadius: 2 }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>Source Details</Typography>
              <Table size="small">
                <TableBody>
                  <TableRow><TableCell>First Seen</TableCell><TableCell>{srcDetails.first_seen}</TableCell></TableRow>
                  <TableRow><TableCell>Last Seen</TableCell><TableCell>{srcDetails.last_seen}</TableCell></TableRow>
                  <TableRow><TableCell>Times Seen</TableCell><TableCell>{srcDetails.times_seen}</TableCell></TableRow>
                  <TableRow><TableCell>Country</TableCell><TableCell>{srcDetails.src_countrycode} {srcDetails.src_countrycode ? String.fromCodePoint(127397 + srcDetails.src_countrycode.charCodeAt(0)) + String.fromCodePoint(127397 + srcDetails.src_countrycode.charCodeAt(1)) : ''}</TableCell></TableRow>
                  <TableRow><TableCell>Region</TableCell><TableCell>{srcDetails.src_regionname} ({srcDetails.src_region})</TableCell></TableRow>
                  <TableRow><TableCell>City</TableCell><TableCell>{srcDetails.src_city}</TableCell></TableRow>
                  <TableRow><TableCell>ZIP</TableCell><TableCell>{srcDetails.src_zip}</TableCell></TableRow>
                  <TableRow><TableCell>Latitude</TableCell><TableCell>{srcDetails.src_latitude}</TableCell></TableRow>
                  <TableRow><TableCell>Longitude</TableCell><TableCell>{srcDetails.src_longitude}</TableCell></TableRow>
                  <TableRow><TableCell>Timezone</TableCell><TableCell>{srcDetails.src_timezone}</TableCell></TableRow>
                  <TableRow><TableCell>ISP</TableCell><TableCell>{srcDetails.src_isp}</TableCell></TableRow>
                  <TableRow><TableCell>Org</TableCell><TableCell>{srcDetails.src_org}</TableCell></TableRow>
                  <TableRow><TableCell>AS Number</TableCell><TableCell>{srcDetails.src_asnum}</TableCell></TableRow>
                  <TableRow><TableCell>AS Org</TableCell><TableCell>{srcDetails.src_asorg}</TableCell></TableRow>
                  <TableRow><TableCell>Reverse DNS</TableCell><TableCell>{srcDetails.src_reversedns}</TableCell></TableRow>
                  <TableRow><TableCell>Mobile</TableCell><TableCell>{srcDetails.src_mobile ? 'Yes' : 'No'}</TableCell></TableRow>
                  <TableRow><TableCell>Proxy</TableCell><TableCell>{srcDetails.src_proxy ? 'Yes' : 'No'}</TableCell></TableRow>
                  <TableRow><TableCell>Hosting</TableCell><TableCell>{srcDetails.src_hosting ? 'Yes' : 'No'}</TableCell></TableRow>
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>No source details found.</Typography>
          )}
          {/* Logs table */}
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Node</TableCell>
                  <TableCell>Dest Port</TableCell>
                  <TableCell>Username</TableCell>
                  <TableCell>Password</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(grouped[selectedSrc] || []).map((log, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{log.utc_time}</TableCell>
                    <TableCell>{log.node_id}</TableCell>
                    <TableCell>{log.dst_port}</TableCell>
                    <TableCell>{log.logdata_username}</TableCell>
                    <TableCell>{log.logdata_password}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
      </Dialog>
    </Box>
  );
}