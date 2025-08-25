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

  useEffect(() => {
    axios.get('/api/logs').then(res => {
      setLogs(res.data.logs || []);
    });
  }, []);

  useEffect(() => {
    setGrouped(groupLogsBySrcHost(logs));
  }, [logs]);

  const handleOpen = src => {
    setSelectedSrc(src);
    setOpen(true);
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
          {sortedSrcs.map(src => (
            <ListItem key={src} secondaryAction={
              <IconButton edge="end" onClick={() => handleOpen(src)}>
                <InfoIcon color="primary" />
              </IconButton>
            }>
              <ListItemText
                primary={<>
                  <Badge badgeContent={grouped[src].length} color="secondary" sx={{ mr: 2 }} />
                  <span style={{ fontWeight: 600 }}>{src}</span>
                </>}
                secondary={`Most recent: ${grouped[src][0]?.utc_time || 'N/A'}`}
              />
            </ListItem>
          ))}
        </List>
      </Paper>
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>Logs for {selectedSrc}</DialogTitle>
        <DialogContent>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Node</TableCell>
                  <TableCell>Dest Port</TableCell>
                  <TableCell>Local Version</TableCell>
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
                    <TableCell>{log.logdata_localversion}</TableCell>
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
