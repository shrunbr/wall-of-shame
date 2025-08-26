import React, { useEffect, useState } from 'react';
import { Pagination, Select, MenuItem, FormControl, InputLabel } from '@mui/material';
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

// GitHub SVG icon (inline, accessible)
function GitHubIcon({ size = 24 }) {
  return (
    <svg height={size} width={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ verticalAlign: 'middle' }}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.11.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

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
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    axios.get('/api/logs').then(res => {
      setLogs(res.data.logs || res.data.data || res.data || []);
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
        const result = await res.json();
        if (cancelled) return;
        const geoWithFlag = {};
        for (const [ip, cc] of Object.entries(result.data || {})) {
          let flag = '🏳️';
          if (cc && cc.length === 2 && /^[A-Z]{2}$/i.test(cc)) {
            const up = cc.toUpperCase();
            flag = String.fromCodePoint(up.charCodeAt(0) + 127397) + String.fromCodePoint(up.charCodeAt(1) + 127397);
          }
          geoWithFlag[ip] = { country: cc || '??', flag };
        }
        setGeo(prev => ({ ...prev, ...geoWithFlag }));
      } catch (e) {
        const fallback = {};
        for (const ip of missing) fallback[ip] = { country: '??', flag: '🏳️' };
        setGeo(prev => ({ ...prev, ...fallback }));
      }
    })();
    return () => { cancelled = true; };
  }, [grouped]);

  const handleOpen = async src => {
    setSelectedSrc(src);
    setSrcDetails(null);
    setSrcDetailsLoading(true);
    setOpen(true);
    try {
      const res = await axios.get(`/api/source_details/${encodeURIComponent(src)}`);
      const details = res.data.logs || res.data.data || res.data || [];
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

  // Pagination logic
  const totalPages = Math.ceil(sortedSrcs.length / rowsPerPage) || 1;
  const pagedSrcs = sortedSrcs.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handlePageChange = (event, value) => {
    setPage(value);
  };
  const handleRowsPerPageChange = (event) => {
    setRowsPerPage(Number(event.target.value));
    setPage(1);
  };


  // Top stats from API
  const [topStats, setTopStats] = useState({});
  useEffect(() => {
    axios.get('/api/topstats').then(res => {
      setTopStats(res.data.logs || res.data.data || res.data || []);
    });
  }, []);

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    }}>
      <Box sx={{
        flex: '1 0 auto',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'flex-start',
        width: '100%',
        mt: 4,
        mb: 4,
      }}>
        {/* Main logs list */}
        <Paper elevation={6} sx={{ width: 600, maxWidth: '100%', p: 3, borderRadius: 4, background: 'rgba(255,255,255,0.95)', mr: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom align="center" color="primary">
          Wall of Shame Logs
        </Typography>
        <List>
          {pagedSrcs.map(src => {
            const meta = geo[src];
            return (
              <ListItem key={src} secondaryAction={
                <IconButton edge="end" onClick={() => handleOpen(src)}>
                  <InfoIcon color="primary" />
                </IconButton>
              }>
                <ListItemText
                  primary={<>
                    <b>{src}</b>
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
        {/* Pagination controls */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, justifyContent: 'space-between' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="rows-per-page-label">Per page</InputLabel>
            <Select
              labelId="rows-per-page-label"
              value={rowsPerPage}
              label="Per page"
              onChange={handleRowsPerPageChange}
            >
              {[10, 25, 50, 100].map(opt => (
                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Pagination
            count={totalPages}
            page={page}
            onChange={handlePageChange}
            color="primary"
            shape="rounded"
            showFirstButton
            showLastButton
          />
        </Box>
      </Paper>
  {/* Top stats summary box */}
  <Paper elevation={4} sx={{ minWidth: 280, maxWidth: 320, p: 3, borderRadius: 4, background: 'rgba(255,255,255,0.97)', alignSelf: 'flex-start', position: 'sticky', top: 32, height: 'fit-content', boxShadow: 6 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom color="primary">Top Stats</Typography>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Top Source IP</Typography>
          <Box
            component="span"
            role={topStats.top_src ? "button" : undefined}
            tabIndex={topStats.top_src ? 0 : -1}
            onClick={() => topStats.top_src && handleOpen(topStats.top_src)}
            onKeyDown={(e) => { if (topStats.top_src && (e.key === 'Enter' || e.key === ' ')) handleOpen(topStats.top_src); }}
            sx={{ fontWeight: 600, cursor: topStats.top_src ? 'pointer' : 'default', color: topStats.top_src ? 'primary.main' : 'inherit', display: 'inline-block' }}
            aria-label={topStats.top_src ? `Open details for ${topStats.top_src}` : undefined}
          >
            {topStats.top_src || 'N/A'}
          </Box>
        </Box>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Top AS Number</Typography>
          {topStats.top_as ? (
            <Box
              component="a"
              href={`https://bgp.he.net/AS${String(topStats.top_as).replace(/^AS/i, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                fontWeight: 600,
                color: 'primary.main',
                textDecoration: 'none',
                cursor: 'pointer',
                display: 'inline-block'
              }}
              aria-label={`Open BGP information for AS${String(topStats.top_as).replace(/^AS/i, '')}`}
            >
              {topStats.top_as}
            </Box>
          ) : (
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{'N/A'}</Typography>
          )}
        </Box>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Top ISP</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{topStats.top_isp || 'N/A'}</Typography>
        </Box>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Top Country</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{topStats.top_country || 'N/A'}</Typography>
        </Box>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Top Username</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{topStats.top_username || 'N/A'}</Typography>
        </Box>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Top Password</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{topStats.top_password || 'N/A'}</Typography>
        </Box>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2">Top Target Node</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{topStats.top_node || 'N/A'}</Typography>
        </Box>
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
                  <TableRow><TableCell>Country</TableCell><TableCell>{srcDetails.src_country} {srcDetails.src_isocountrycode ? String.fromCodePoint(127397 + srcDetails.src_isocountrycode.charCodeAt(0)) + String.fromCodePoint(127397 + srcDetails.src_isocountrycode.charCodeAt(1)) : ''}</TableCell></TableRow>
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
                  <TableRow><TableCell>BGP Information</TableCell><TableCell><a href={`https://bgp.he.net/ip/${selectedSrc}`} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, textDecoration: 'none', color: '#1976d2' }}><b>Hurricane Electric</b></a></TableCell></TableRow>
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
      {/* Footer */}
  </Box>
  {/* Footer pinned to bottom */}
  <Box component="footer" sx={{ mt: 'auto', py: 2, textAlign: 'center', color: '#888', width: '100%', background: 'rgba(0,0,0,0.03)' }}>
        <a href="https://github.com/shrunbr/wall-of-shame" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', marginRight: 8 }} title="GitHub Repository">
          <GitHubIcon size={28} />
        </a>
        <span style={{ marginLeft: 8, fontSize: 14 }}>
          <br />
          Check out my other stuff on <a href="https://github.com/shrunbr" target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2', textDecoration: 'none' }}>GitHub</a>
          <br />
          Source IP details provided by <a href="https://ip-api.com/" target="_blank" rel="noopener noreferrer" style={{ color: '#1976d2', textDecoration: 'none' }}>ip-api.com</a>
        </span>
      </Box>
    </Box>
  );
}