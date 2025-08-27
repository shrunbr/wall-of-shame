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

import PublicIcon from '@mui/icons-material/Public';
import DnsIcon from '@mui/icons-material/Dns';
import FlagIcon from '@mui/icons-material/Flag';
import PersonIcon from '@mui/icons-material/Person';
import LockIcon from '@mui/icons-material/Lock';
import DevicesIcon from '@mui/icons-material/Devices';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import VpnKeyIcon from '@mui/icons-material/VpnKey';

// GitHub SVG icon (inline, accessible)
function GitHubIcon({ size = 24 }) {
  return (
    <svg height={size} width={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={{ verticalAlign: 'middle' }}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.01.08-2.12 0 0 .67-.21 2.0.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.11.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.19 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export default function App() {
  const [grouped, setGrouped] = useState({});
  const [selectedSrc, setSelectedSrc] = useState(null);
  const [open, setOpen] = useState(false);
  const [geo, setGeo] = useState({});
  const [srcDetails, setSrcDetails] = useState(null);
  const [srcDetailsLoading, setSrcDetailsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [srcList, setSrcList] = useState([]);
  const [totalSrc, setTotalSrc] = useState(0);
  const [logsForSrc, setLogsForSrc] = useState([]);

  // Fetch paginated source list (server should return { data: [...], total: <int> })
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await axios.get('/api/logs', { params: { page, per_page: rowsPerPage } });
        if (cancelled) return;
        const payload = res.data || {};
        setSrcList(payload.data || []);
        setTotalSrc(Number(payload.total || (payload.data ? payload.data.length : 0)));
      } catch (e) {
        setSrcList([]);
        setTotalSrc(0);
      }
    })();
    return () => { cancelled = true; };
  }, [page, rowsPerPage]);

  // Fetch GeoIP/country data for visible source IPs in the current srcList (batch)
  useEffect(() => {
    let cancelled = false;
    const ips = (srcList || []).map(item => item.src_host).filter(ip => ip && ip !== 'Unknown');
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
  }, [srcList]);

  const handleOpen = async src => {
    setSelectedSrc(src);
    setSrcDetails(null);
    setLogsForSrc([]);
    setSrcDetailsLoading(true);
    setOpen(true);
    try {
      const [detailsRes, logsRes] = await Promise.all([
        axios.get(`/api/source_details/${encodeURIComponent(src)}`),
        axios.get('/api/logs', { params: { src } })
      ]);
      const details = detailsRes.data.logs || detailsRes.data.data || detailsRes.data || [];
      setSrcDetails(Array.isArray(details) ? details[0] : details);
      const logs = logsRes.data.data || logsRes.data.logs || [];
      setLogsForSrc(logs);
    } catch (e) {
      setSrcDetails(null);
      setLogsForSrc([]);
    } finally {
      setSrcDetailsLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSelectedSrc(null);
    setSrcDetails(null);
    setLogsForSrc([]);
  };

  const sortedSrcs = [...(srcList || [])].sort((a, b) => {
    const ta = a?.last_seen ? new Date(a.last_seen).getTime() : 0;
    const tb = b?.last_seen ? new Date(b.last_seen).getTime() : 0;
    return tb - ta;
  });

  const totalPages = Math.max(1, Math.ceil((totalSrc || srcList?.length || 0) / rowsPerPage));
  const pagedSrcs = sortedSrcs;

  const handlePageChange = (event, value) => {
    setPage(value);
  };
  const handleRowsPerPageChange = (event) => {
    setRowsPerPage(Number(event.target.value));
    setPage(1);
  };

  // Top stats from API
  const [apiStats, setApiStats] = useState({});
  useEffect(() => {
    axios.get('/api/stats').then(res => {
      setApiStats(res.data.logs || res.data.data || res.data || []);
    });
  }, []);

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'linear-gradient(135deg, #232526 0%, #414345 100%)',
    }}>
      {/* Stats bar at the top */}
      <Paper elevation={6} sx={{
        width: { xs: '95%', sm: '70%', md: '50%' },
        mx: 'auto',
        mt: 6,
        mb: 2,
        p: 2,
        borderRadius: 4,
        background: 'rgba(255,255,255,0.97)',
        boxShadow: 8,
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        flexWrap: 'wrap',
        position: 'relative',
        zIndex: 2,
      }}>
        {/* Each stat in its own box with icon */}
        <Box sx={{ minWidth: 110, textAlign: 'center', m: 1 }}>
          <PublicIcon color="primary" fontSize="large" />
          <Typography variant="subtitle2">Top Source IP</Typography>
          <Box
            component="span"
            role={apiStats.top_src ? "button" : undefined}
            tabIndex={apiStats.top_src ? 0 : -1}
            onClick={() => apiStats.top_src && handleOpen(apiStats.top_src)}
            onKeyDown={(e) => { if (apiStats.top_src && (e.key === 'Enter' || e.key === ' ')) handleOpen(apiStats.top_src); }}
            sx={{ fontWeight: 600, cursor: apiStats.top_src ? 'pointer' : 'default', color: apiStats.top_src ? 'primary.main' : 'inherit', display: 'inline-block' }}
            aria-label={apiStats.top_src ? `Open details for ${apiStats.top_src}` : undefined}
          >
            {apiStats.top_src || 'N/A'}
          </Box>
        </Box>
        <Box sx={{ minWidth: 110, textAlign: 'center', m: 1 }}>
          <DnsIcon color="primary" fontSize="large" />
          <Typography variant="subtitle2">Top AS Number</Typography>
          {apiStats.top_as ? (
            <Box
              component="a"
              href={`https://bgp.he.net/AS${String(apiStats.top_as).replace(/^AS/i, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                fontWeight: 600,
                color: 'primary.main',
                textDecoration: 'none',
                cursor: 'pointer',
                display: 'inline-block'
              }}
              aria-label={`Open BGP information for AS${String(apiStats.top_as).replace(/^AS/i, '')}`}
            >
              {apiStats.top_as}
            </Box>
          ) : (
            <Typography variant="body1" sx={{ fontWeight: 600 }}>{'N/A'}</Typography>
          )}
        </Box>
        <Box sx={{ minWidth: 110, textAlign: 'center', m: 1 }}>
          <FlagIcon color="primary" fontSize="large" />
          <Typography variant="subtitle2">Top Country</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{apiStats.top_country || 'N/A'}</Typography>
        </Box>
        <Box sx={{ minWidth: 110, textAlign: 'center', m: 1 }}>
          <AccountCircleIcon color="primary" fontSize="large" />
          <Typography variant="subtitle2">Top Username</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{apiStats.top_username || 'N/A'}</Typography>
        </Box>
        <Box sx={{ minWidth: 110, textAlign: 'center', m: 1 }}>
          <VpnKeyIcon color="primary" fontSize="large" />
          <Typography variant="subtitle2">Top Password</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{apiStats.top_password || 'N/A'}</Typography>
        </Box>
        <Box sx={{ minWidth: 110, textAlign: 'center', m: 1 }}>
          <DevicesIcon color="primary" fontSize="large" />
          <Typography variant="subtitle2">Top Target Node</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{apiStats.top_node || 'N/A'}</Typography>
        </Box>
        <Box sx={{ minWidth: 110, textAlign: 'center', m: 1 }}>
          <PersonIcon color="primary" fontSize="large" />
          <Typography variant="subtitle2">Total Unique Sources</Typography>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{apiStats.total_unique_srcs || 'N/A'}</Typography>
        </Box>
      </Paper>
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
        <Paper elevation={6} sx={{ width: 700, maxWidth: '100%', p: 3, borderRadius: 4, background: 'rgba(255,255,255,0.95)', mr: 4 }}>
        <Typography variant="h4" fontWeight={700} gutterBottom align="center" color="primary">
          Wall of Shame Logs
        </Typography>
        <List>
          {pagedSrcs.map(item => {
            const src = item.src_host;
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
                  secondary={`Most recent: ${item.last_seen || 'N/A'}${item.times_seen ? ` — ${item.times_seen} hits` : ''}`}
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
                {(logsForSrc || []).map((log, idx) => (
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